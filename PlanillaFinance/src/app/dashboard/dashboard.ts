import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { API_URL, getAuthHeaders } from '../api-config';

@Component({
    selector: 'app-dashboard',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './dashboard.html',
    styleUrl: './dashboard.css'
})
export class DashboardComponent implements OnInit {
    stats: any[] = [];
    birthdays: any[] = [];
    contractExpirations: any[] = [];
    unpaidInvoices: any[] = [];
    pendingCajaVirtual: any[] = [];
    totalPendingCaja: number = 0;

    constructor(private router: Router) { }

    async ngOnInit() {
        await this.loadStats();
    }

    async loadStats() {
        try {
            const response = await fetch(`${API_URL}/api/dashboard/stats`, {
                headers: getAuthHeaders()
            });
            const data = await response.json();
            this.stats = data.stats || [];
            this.birthdays = data.birthdays || [];
            this.contractExpirations = data.contractExpirations || [];
            this.unpaidInvoices = data.unpaidInvoices || [];
            this.pendingCajaVirtual = data.pendingCajaVirtual || [];
            this.totalPendingCaja = data.totalPendingCaja || 0;

            try {
                const empResponse = await fetch(`${API_URL}/api/planilla-borrador`, { headers: getAuthHeaders() });
                if (empResponse.ok) {
                    const empData = await empResponse.json();
                    const currentMonthIndex = new Date().getMonth();
                    const currentYear = new Date().getFullYear();
                    
                    let totalNeto = 0;
                    
                    empData.forEach((emp: any) => {
                        const bonosDetalle = emp.bonosDetalle || [];
                        const validBonos = bonosDetalle.filter((b: any) => {
                            if (b.permanente) return true;
                            if (!b.fecha) return false;
                            const bd = new Date(b.fecha);
                            return bd.getMonth() === currentMonthIndex && bd.getFullYear() === currentYear;
                        });
                        const bonosTotal = validBonos.reduce((sum: number, b: any) => sum + (b.monto || 0), 0);

                        const sueldo = emp.sueldo || 0;
                        const hourlyRate = (sueldo / 240) * 1.25;
                        const montoHorasExtras = hourlyRate * (emp.horasExtras || 0);
                        const totalIngresos = sueldo + montoHorasExtras + bonosTotal;

                        let afpRate = 0;
                        if (emp.tipoTrabajador !== 'RXH' && emp.tipoTrabajador !== 'HONORARIOS') {
                            const regimenUpper = (emp.regimenPensionario || '').toUpperCase();
                            if (regimenUpper.includes('INTEGRA') || regimenUpper.includes('PRIMA') || regimenUpper.includes('HABITAT') || regimenUpper.includes('PROFUTURO')) {
                                afpRate = 0.1138;
                            } else if (regimenUpper.includes('SNP') || regimenUpper.includes('ONP')) {
                                afpRate = 0.13;
                            }
                        }
                        
                        const MINIMO_PARA_AFP = 1130;
                        const descuentoAfp = parseFloat((MINIMO_PARA_AFP * afpRate).toFixed(2));
                        
                        const dayRate = sueldo / 30;
                        const hourRate = dayRate / 8;
                        const montoFaltas = parseFloat(((dayRate * (emp.faltasDias || 0)) + (hourRate * (emp.faltasHoras || 0))).toFixed(2));
                        
                        const adelanto = emp.adelanto || 0;
                        const prestamo = emp.prestamo || 0;
                        const descuentoAdicional = emp.descuentoAdicional || 0;
                        
                        const totalDescuento = descuentoAfp + adelanto + prestamo + montoFaltas + descuentoAdicional;
                        const neto = totalIngresos - totalDescuento;
                        totalNeto += neto;
                    });
                    
                    const nominaStatIndex = this.stats.findIndex(s => s.title.includes('Nómina'));
                    if (nominaStatIndex !== -1) {
                        this.stats[nominaStatIndex].title = 'Nómina Total (Neto a Pagar)';
                        this.stats[nominaStatIndex].value = `S/ ${totalNeto.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                        this.stats[nominaStatIndex].change = 'Proyección mes actual';
                    }
                }
            } catch (e) {
                console.error('Error calculating neto para dashboard:', e);
            }
        } catch (error) {
            console.error('Error loading dashboard stats:', error);
            this.stats = [
                { title: 'Error', value: '---', change: 'Error de conexión', icon: '❌', color: 'red' }
            ];
        }
    }

    goToFinance(invoiceId: any) {
        this.router.navigate(['/finance'], { queryParams: { highlight: invoiceId } });
    }
}
