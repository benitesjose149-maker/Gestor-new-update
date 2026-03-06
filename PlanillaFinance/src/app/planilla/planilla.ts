
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { API_URL } from '../api-config';

interface PayrollEmployee {
    _id: string;
    nombre: string;
    apellidos: string;
    cargo: string;
    sueldo: number;
    tipoTrabajador: string;
    regimenPensionario: string;
    entidadDisplay?: string; // New field for display
    calculoAfpMinimo: boolean;
    asignacionFamiliar: boolean;

    // Editable fields
    bonos: number;
    horasExtras: number;
    adelanto: number;
    prestamo: number;
    faltasDias: number;
    faltasHoras: number;
    descuentoAdicional: number;
    cuotaDetalle: string;

    // Calculated fields
    bonosDetalle: any[];
    montoHorasExtras: number;
    montoAsignacionFamiliar: number;
    baseCalculo: number;
    afpPorcentaje: number;
    descuentoAfp: number;
    montoFaltas: number;
    totalDescuento: number;
    remuneracionNeta: number;
    estado: string;
    observaciones: string;
}

@Component({
    selector: 'app-planilla',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './planilla.html',
    styleUrl: './planilla.css'
})
export class PlanillaComponent implements OnInit {
    employees: PayrollEmployee[] = [];
    currentMonth: string = '';
    currentYear: number = new Date().getFullYear();

    // Modal Details
    showDetailModal: boolean = false;
    selectedEmployee: PayrollEmployee | null = null;

    ngOnInit() {
        this.currentMonth = new Date().toLocaleString('es-ES', { month: 'long' });
        this.loadEmployees();
    }

    async loadEmployees() {
        try {
            const empResponse = await fetch(API_URL + '/api/planilla-borrador');
            const data = await empResponse.json();

            // Calculate current month index (0-11)
            const monthNames = [
                'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
            ];
            const currentMonthLower = this.currentMonth.toLowerCase();
            const currentMonthIndex = monthNames.findIndex(m => m === currentMonthLower);

            this.employees = data.map((emp: any) => {
                const bonosDetalle = emp.bonosDetalle || [];
                const validBonos = bonosDetalle.filter((b: any) => {
                    if (b.permanente) return true;
                    if (!b.fecha) return false;
                    const bd = new Date(b.fecha);
                    return bd.getMonth() === currentMonthIndex && bd.getFullYear() === this.currentYear;
                });
                const bonosTotal = validBonos.reduce((sum: number, b: any) => sum + (b.monto || 0), 0);

                return {
                    ...emp,
                    bonosDetalle: bonosDetalle,
                    bonos: bonosTotal,
                    horasExtras: emp.horasExtras || 0,
                    // Use backend-calculated values from ADVANCES table
                    adelanto: emp.adelanto || 0,
                    prestamo: emp.prestamo || 0,
                    faltasDias: emp.faltasDias || 0,
                    faltasHoras: emp.faltasHoras || 0,
                    descuentoAdicional: emp.descuentoAdicional || 0,
                    descuentosAdicionales: emp.descuentosAdicionales || [],
                    observaciones: emp.observaciones || '',
                    montoAsignacionFamiliar: emp.asignacionFamiliar ? 102.50 : 0
                };
            });

            this.employees.forEach(emp => {
                const entidad = (emp as any).entidadPrevisional || '';
                if (entidad.includes('INTEGRA')) emp.regimenPensionario = 'AFP_INTEGRA';
                if (entidad.includes('PRIMA')) emp.regimenPensionario = 'AFP_PRIMA';
                if (entidad.includes('HABITAT')) emp.regimenPensionario = 'AFP_HABITAT';
                if (entidad.includes('PROFUTURO')) emp.regimenPensionario = 'AFP_PROFUTURO';
            });

            this.calculateAll();
        } catch (error) {
            console.error('Error loading employees:', error);
        }
    }

    // Modal open/close
    openDetailModal(emp: PayrollEmployee) {
        this.selectedEmployee = emp;
        this.showDetailModal = true;
    }

    closeDetailModal() {
        this.showDetailModal = false;
        this.selectedEmployee = null;
    }

    async updateEmployee(emp: PayrollEmployee) {
        try {
            await fetch(API_URL + `/api/planilla-borrador/${emp._id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(emp)
            });
        } catch (error) {
            console.error('Error updating employee:', error);
        }
    }

    calculateAll() {
        this.employees.forEach(emp => this.calculateEmployee(emp, false));
    }

    calculateEmployee(emp: PayrollEmployee, save: boolean = true) {
        // Handle Display for Entidad / Regimen
        if (emp.tipoTrabajador === 'RXH' || emp.tipoTrabajador === 'HONORARIOS') {
            emp.entidadDisplay = 'HONORARIOS';

            // Force values to 0 for RXH
            emp.montoAsignacionFamiliar = 0;
            emp.afpPorcentaje = 0;
            emp.descuentoAfp = 0;
        } else {
            emp.entidadDisplay = emp.regimenPensionario?.replace(/_/g, ' ').replace('AFP', 'AFP ');
            if (emp.regimenPensionario === 'SNP') emp.entidadDisplay = 'ONP (SNP)';
        }

        const sueldo = emp.sueldo || 0;
        emp.baseCalculo = sueldo + (emp.bonos || 0);

        const hourlyRate = (emp.baseCalculo / 240) * 1.25;
        // High precision for OT
        emp.montoHorasExtras = hourlyRate * (emp.horasExtras || 0);

        const totalIngresos = sueldo + emp.montoHorasExtras + (emp.bonos || 0);
        if (emp.tipoTrabajador === 'PLANILLA') {
            let afpRate = 0;
            switch (emp.regimenPensionario) {
                case 'SNP': afpRate = 0.13; break;
                case 'AFP_INTEGRA':
                case 'AFP_PRIMA':
                case 'AFP_HABITAT':
                case 'AFP_PROFUTURO':
                    afpRate = 0.1138;
                    break;
                default: afpRate = 0;
            }
            emp.afpPorcentaje = afpRate * 100;

            let baseAfp = totalIngresos;

            if (emp.calculoAfpMinimo) {
                baseAfp = 1130;
            }

            emp.descuentoAfp = parseFloat((baseAfp * afpRate).toFixed(2));
        }

        // Absences deduction based on Base de Cálculo (Sueldo + Bono)
        const dayRate = emp.baseCalculo / 30;
        const hourRate = dayRate / 8;
        emp.montoFaltas = parseFloat(((dayRate * emp.faltasDias) + (hourRate * emp.faltasHoras)).toFixed(2));

        // Total Discounts
        emp.totalDescuento = emp.descuentoAfp + emp.adelanto + emp.prestamo + emp.montoFaltas + emp.descuentoAdicional;
        emp.totalDescuento = parseFloat(emp.totalDescuento.toFixed(2));

        // Net Salary
        emp.remuneracionNeta = totalIngresos - emp.totalDescuento;
        emp.remuneracionNeta = parseFloat(emp.remuneracionNeta.toFixed(2));

        if (save) {
            this.updateEmployee(emp);
        }
    }

    exportToExcel() {
        alert('Funcionalidad de exportar a Excel pendiente de implementación');
    }

    async savePlanilla() {
        if (!confirm('¿Guardar la planilla del mes actual? Se guardará en el historial de pagos.')) return;

        const monthNames = [
            'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
            'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
        ];
        const currentMonthIndex = monthNames.findIndex(m => m === this.currentMonth.toLowerCase());
        const periodo = `${this.currentYear}-${String(currentMonthIndex + 1).padStart(2, '0')}`;

        const payload = {
            periodo,
            mes: this.currentMonth,
            año: this.currentYear,
            empleados: this.employees.map(emp => ({
                empleadoId: emp._id,
                nombre: emp.nombre,
                apellidos: emp.apellidos,
                cargo: emp.cargo,
                tipoTrabajador: emp.tipoTrabajador,
                sueldo: emp.sueldo,
                bonos: emp.bonos,
                bonosDetalle: emp.bonosDetalle || [],
                horasExtras: emp.horasExtras,
                montoHorasExtras: emp.montoHorasExtras,
                regimenPensionario: emp.regimenPensionario,
                descuentoAfp: emp.descuentoAfp,
                adelanto: emp.adelanto,
                prestamo: emp.prestamo,
                faltasDias: emp.faltasDias,
                faltasHoras: emp.faltasHoras,
                montoFaltas: emp.montoFaltas,
                descuentoAdicional: emp.descuentoAdicional,
                totalDescuento: emp.totalDescuento,
                remuneracionNeta: emp.remuneracionNeta,
                observaciones: emp.observaciones
            }))
        };

        try {
            const response = await fetch(API_URL + '/api/historial-pago', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                alert(`✅ Planilla de ${this.currentMonth} ${this.currentYear} guardada correctamente en el historial de pagos.`);
            } else {
                const err = await response.json();
                alert('❌ Error al guardar: ' + (err.error || 'Desconocido'));
            }
        } catch (error) {
            console.error('Error guardando planilla:', error);
            alert('❌ Error de conexión al guardar la planilla.');
        }
    }

    async resetFields() {
        if (!confirm('¿Limpiar todos los campos editables? Los bonos FIJOS se mantendrán.')) return;

        try {
            await fetch(API_URL + '/api/planilla-borrador', { method: 'DELETE' });
        } catch (error) {
            console.error('Error clearing borrador:', error);
        }

        this.employees.forEach(emp => {
            emp.horasExtras = 0;
            emp.montoHorasExtras = 0;
            emp.adelanto = 0;
            emp.prestamo = 0;
            emp.faltasDias = 0;
            emp.faltasHoras = 0;
            emp.descuentoAdicional = 0;
            (emp as any).descuentosAdicionales = [];
            emp.observaciones = '';

            // Keep only permanent bonuses, remove single-month ones
            const permanentBonos = (emp.bonosDetalle || []).filter((b: any) => b.permanente === true);
            emp.bonosDetalle = permanentBonos;
            emp.bonos = permanentBonos.reduce((sum: number, b: any) => sum + (b.monto || 0), 0);

            this.calculateEmployee(emp, true);
        });

        alert('✅ Campos limpiados. Los bonos fijos se mantuvieron.');
    }

    // Modal Logic
    showDeductionModal: boolean = false;
    deductionDetail: any = {
        title: '',
        sueldo: 0,
        valorUnitario: 0,
        cantidad: 0,
        total: 0,
        type: '' // 'DIA' or 'HORA'
    };

    openDeductionModal(emp: PayrollEmployee, type: 'DIA' | 'HORA') {
        const sueldo = emp.sueldo || 0;
        const baseCalculo = sueldo + (emp.bonos || 0);
        const valorDia = baseCalculo / 30;
        const valorHora = valorDia / 8;

        this.deductionDetail = {
            title: type === 'DIA' ? 'Descuento por Días de Falta' : 'Descuento por Horas de Falta',
            empName: `${emp.nombre} ${emp.apellidos}`,
            sueldo: sueldo,
            baseCalculo: baseCalculo,
            type: type,
            valorUnitario: type === 'DIA' ? valorDia : valorHora,
            cantidad: type === 'DIA' ? (emp.faltasDias || 0) : (emp.faltasHoras || 0),
            total: type === 'DIA' ? (valorDia * (emp.faltasDias || 0)) : (valorHora * (emp.faltasHoras || 0)),
            formula: type === 'DIA' ? `S/ ${baseCalculo} ÷ 30` : `S/ ${valorDia.toFixed(2)} ÷ 8`,
            unrounded: type === 'DIA' ? valorDia : valorHora
        };

        this.showDeductionModal = true;
    }

    closeDeductionModal() {
        this.showDeductionModal = false;
    }

    // Additional Discount Modal
    // Additional Discount Modal
    showAdditionalModal: boolean = false;
    additionalDetail: any = {
        empId: '',
        empName: '',
        cargo: '',
        sueldo: 0,
        items: [], // Array of { motivo, fecha, monto }
        newItem: {
            motivo: '',
            fecha: '',
            monto: 0
        }
    };

    openAdditionalDiscountModal(emp: PayrollEmployee) {
        this.additionalDetail = {
            empId: emp._id,
            empName: `${emp.nombre} ${emp.apellidos}`,
            cargo: emp.cargo,
            sueldo: emp.sueldo,
            items: (emp as any).descuentosAdicionales ? [...(emp as any).descuentosAdicionales] : [],
            newItem: {
                motivo: '',
                fecha: new Date().toISOString().split('T')[0],
                monto: 0
            }
        };
        this.showAdditionalModal = true;
    }

    addDiscountItem() {
        if (this.additionalDetail.newItem.monto > 0) {
            this.additionalDetail.items.push({ ...this.additionalDetail.newItem });
            // Reset new item
            this.additionalDetail.newItem = {
                motivo: '',
                fecha: new Date().toISOString().split('T')[0],
                monto: 0
            };
        }
    }

    removeDiscountItem(index: number) {
        this.additionalDetail.items.splice(index, 1);
    }

    saveAdditionalDiscount() {
        const emp = this.employees.find(e => e._id === this.additionalDetail.empId);
        if (emp) {
            // Update array
            (emp as any).descuentosAdicionales = this.additionalDetail.items;

            // Recalculate total
            const total = this.additionalDetail.items.reduce((sum: number, item: any) => sum + item.monto, 0);
            emp.descuentoAdicional = total;

            this.calculateEmployee(emp, true); // Calculate and Save
        }
        this.closeAdditionalModal();
    }

    closeAdditionalModal() {
        this.showAdditionalModal = false;
    }

    // Modal de Bonos
    showBonoModal: boolean = false;
    bonoDetail: any = {
        empId: '',
        empName: '',
        cargo: '',
        sueldo: 0,
        items: [],
        newItem: {
            motivo: '',
            fecha: '',
            monto: 0,
            permanente: false
        }
    };

    openBonoModal(emp: PayrollEmployee) {
        this.bonoDetail = {
            empId: emp._id,
            empName: `${emp.nombre} ${emp.apellidos}`,
            cargo: emp.cargo,
            sueldo: emp.sueldo,
            items: emp.bonosDetalle ? [...emp.bonosDetalle] : [],
            newItem: {
                motivo: '',
                fecha: new Date().toISOString().split('T')[0],
                monto: 0,
                permanente: false
            }
        };
        this.showBonoModal = true;
    }

    addBonoItem() {
        if (this.bonoDetail.newItem.monto > 0) {
            this.bonoDetail.items.push({ ...this.bonoDetail.newItem });
            this.bonoDetail.newItem = {
                motivo: '',
                fecha: new Date().toISOString().split('T')[0],
                monto: 0,
                permanente: false
            };
        }
    }

    removeBonoItem(index: number) {
        this.bonoDetail.items.splice(index, 1);
    }

    saveBonos() {
        const emp = this.employees.find(e => e._id === this.bonoDetail.empId);
        if (emp) {
            emp.bonosDetalle = this.bonoDetail.items;

            const monthNames = [
                'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
            ];
            const currentMonthIndex = monthNames.findIndex(m => m === this.currentMonth.toLowerCase());

            const validBonos = emp.bonosDetalle.filter((b: any) => {
                if (b.permanente) return true;
                if (!b.fecha) return false;
                const bd = new Date(b.fecha);
                return bd.getMonth() === currentMonthIndex && bd.getFullYear() === this.currentYear;
            });

            emp.bonos = validBonos.reduce((sum: number, b: any) => sum + (b.monto || 0), 0);

            this.calculateEmployee(emp, true);
        }
        this.closeBonoModal();
    }

    closeBonoModal() {
        this.showBonoModal = false;
    }
}
