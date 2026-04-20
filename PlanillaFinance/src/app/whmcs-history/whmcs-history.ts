
import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { API_URL, getAuthHeaders } from '../api-config';
import { NotificationService } from '../shared/notification.service';
import { AuditService } from '../shared/audit.service';

@Component({
    selector: 'app-whmcs-history',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './whmcs-history.html',
    styleUrl: './whmcs-history.css'
})
export class WhmcsHistoryComponent implements OnInit {

    loading: boolean = false;
    syncing: boolean = false;
    invoices: any[] = [];

    selectedMonth: number;
    selectedYear: number;
    months = [
        { id: 1, name: 'Enero' }, { id: 2, name: 'Febrero' }, { id: 3, name: 'Marzo' },
        { id: 4, name: 'Abril' }, { id: 5, name: 'Mayo' }, { id: 6, name: 'Junio' },
        { id: 7, name: 'Julio' }, { id: 8, name: 'Agosto' }, { id: 9, name: 'Septiembre' },
        { id: 10, name: 'Octubre' }, { id: 11, name: 'Noviembre' }, { id: 12, name: 'Diciembre' }
    ];
    years: number[] = [];

    totalGross: number = 0;
    totalFees: number = 0;
    totalNet: number = 0;

    showInvoiceModal: boolean = false;
    invoiceDetail: any = null;
    loadingInvoice: boolean = false;

    constructor(
        private cdr: ChangeDetectorRef,
        private notification: NotificationService,
        private audit: AuditService
    ) {
        const now = new Date();
        this.selectedMonth = now.getMonth() + 1;
        this.selectedYear = now.getFullYear();

        for (let i = 0; i < 3; i++) {
            this.years.push(this.selectedYear - i);
        }
    }

    ngOnInit() {
        this.loadHistory();
    }

    toggleEdit(inv: any) {
        inv.editing = !inv.editing;
        if (!inv.editing) {
            this.notification.success('Cambios guardados correctamente');
        }
    }

    async loadHistory(forceSync: boolean = false) {
        this.loading = true;
        if (forceSync) this.syncing = true;

        try {
            const url = `${API_URL}/api/whmcs/invoices?mes=${this.selectedMonth}&anio=${this.selectedYear}&limit=1000${forceSync ? '&sync=true' : ''}`;
            const res = await fetch(url, { headers: getAuthHeaders() });

            if (res.ok) {
                const data = await res.json();
                this.invoices = data.invoices || [];
                this.calculateTotals();

                if (forceSync) {
                    this.notification.success(`Sincronización de ${this.getMonthName(this.selectedMonth)} completada.`);
                    this.audit.log(`Sincronizó historial WHMCS: ${this.selectedMonth}/${this.selectedYear}`, 'Finanzas');
                }
            } else {
                this.notification.error('Error al cargar el historial.');
            }
        } catch (error) {
            console.error('Error loading WHMCS history:', error);
            this.notification.error('Error de conexión.');
        } finally {
            this.loading = false;
            this.syncing = false;
            this.cdr.detectChanges();
        }
    }

    onMontoBrutoChange(inv: any) {
        inv.depositoSalida = (inv.montoBruto || 0) - (inv.comision || 0);
        this.calculateTotals();
        this.onFieldChange(inv);
    }

    onComisionChange(inv: any) {
        inv.depositoSalida = (inv.montoBruto || 0) - (inv.comision || 0);
        this.calculateTotals();
        this.onFieldChange(inv);
    }

    async onFieldChange(inv: any) {
        try {
            const res = await fetch(`${API_URL}/api/finance/invoices/${inv.localId}/metadata`, {
                method: 'POST',
                headers: {
                    ...getAuthHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tipoMovimiento: inv.tipoMovimiento,
                    montoBruto: inv.montoBruto,
                    comision: inv.comision,
                    depositoSalida: inv.depositoSalida,
                    banco: inv.banco,
                    cuentaDebito: inv.cuentaDebito,
                    cuentaCredito: inv.cuentaCredito,
                    codigoContable: inv.codigoContable,
                    estadoLocal: inv.estadoLocal
                })
            });

            if (!res.ok) {
                this.notification.error('Error al guardar cambios.');
            }
        } catch (error) {
            console.error('Error saving field change:', error);
            this.notification.error('Error al guardar los cambios');
        }
    }

    calculateTotals() {
        this.totalGross = this.invoices.reduce((sum, inv) => sum + (Number(inv.montoBruto) || 0), 0);
        this.totalFees = this.invoices.reduce((sum, inv) => sum + (Number(inv.comision) || 0), 0);
        this.totalNet = this.invoices.reduce((sum, inv) => sum + (Number(inv.montoBruto || 0) - Number(inv.comision || 0)), 0);
    }

    getMonthName(id: number): string {
        return this.months.find(m => m.id === id)?.name || '';
    }

    async openInvoiceDetail(invoiceId: number) {
        this.loadingInvoice = true;
        this.invoiceDetail = null;
        this.showInvoiceModal = true;
        try {
            const res = await fetch(`${API_URL}/api/whmcs/invoice/${invoiceId}`, {
                headers: getAuthHeaders()
            });
            const data = await res.json();
            if (data.success) {
                this.invoiceDetail = data.invoice;
            } else {
                this.notification.error('No se pudo cargar la factura.');
                this.showInvoiceModal = false;
            }
        } catch (error) {
            console.error('Error loading invoice detail:', error);
            this.notification.error('Error al cargar detalles.');
            this.showInvoiceModal = false;
        } finally {
            this.loadingInvoice = false;
            this.cdr.detectChanges();
        }
    }

    closeInvoiceModal() {
        this.showInvoiceModal = false;
        this.invoiceDetail = null;
    }

    downloadPdf(invoiceId: number) {
        const url = `${API_URL}/api/whmcs/invoice/${invoiceId}/pdf`;
        window.open(url, '_blank');
    }

    getClientParts(concepto: string) {
        if (!concepto) return { empresa: '', nombre: 'Sin datos', servicio: '' };
        const lines = concepto.split('\n');
        if (lines.length >= 3) {
            return { empresa: lines[0], nombre: lines[1], servicio: lines.slice(2).join(' ') };
        } else if (lines.length === 2) {
            return { empresa: '', nombre: lines[0], servicio: lines[1] };
        }
        return { empresa: '', nombre: lines[0], servicio: '' };
    }
}
