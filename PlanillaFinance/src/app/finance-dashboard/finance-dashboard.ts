
import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { API_URL, getAuthHeaders } from '../api-config';

@Component({
    selector: 'app-finance-dashboard',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './finance-dashboard.html',
    styleUrl: './finance-dashboard.css'
})
export class FinanceDashboardComponent implements OnInit {

    loading: boolean = false;
    items: any[] = [];
    thisMonthPaid: number = 0;
    thisMonthTotal: number = 0;
    thisMonthTotalGross: number = 0;
    thisMonthUnpaid: number = 0;
    totalPayrollNet: number = 0;
    
    // Paginación
    currentPage: number = 1;
    pageSize: any = 25;
    totalPages: number = 1;
    totalResults: number = 0;

    showModal: boolean = false;
    showInvoiceModal: boolean = false;
    invoiceDetail: any = null;
    loadingInvoice: boolean = false;
    nuevoEgreso: any = this.getEmptyEgreso();
    categorias = ['Alimentación', 'Servicios', 'Transporte', 'Suministros', 'Planilla', 'Impuestos', 'Otros'];
    bancosLista = ['BCP', 'INTERBANK', 'YAPE', 'PLIN', 'CAJA VIRTUAL', 'OTRO'];
    tiposEgreso = ['MANUAL', 'YAPE', 'PLIN', 'TARJETA', 'TRANSFERENCIA'];

    movementTypes: any[] = [];
    bancos: any[] = [];
    debitAccounts: any[] = [];
    creditAccounts: any[] = [];
    codigosContables: any[] = [];
    transactionStatuses: any[] = [];

    constructor(private cdr: ChangeDetectorRef) { }

    ngOnInit() {
        this.loadAll();
    }

    async loadAll() {
        this.loading = true;
        try {
            const currentMonth = new Date().getMonth() + 1;
            const currentYear = new Date().getFullYear();

            const parseToLocalMidnight = (dateInput: any) => {
                if (!dateInput) return 0;
                const d = new Date(dateInput);
                const localDate = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0);
                return localDate;
            };

            const [invoicesRes, egresosRes, mtRes, bancosRes, daRes, caRes, ccRes, tsRes, planillaRes] = await Promise.all([
                fetch(API_URL + `/api/whmcs/invoices?mes=${currentMonth}&anio=${currentYear}&page=${this.currentPage}&limit=${this.pageSize}`, { headers: getAuthHeaders() }),
                fetch(API_URL + `/api/finance/egresos?mes=${currentMonth}&anio=${currentYear}`, { headers: getAuthHeaders() }),
                fetch(API_URL + '/api/finance/movement-types', { headers: getAuthHeaders() }),
                fetch(API_URL + '/api/finance/bancos', { headers: getAuthHeaders() }),
                fetch(API_URL + '/api/finance/debit-accounts', { headers: getAuthHeaders() }),
                fetch(API_URL + '/api/finance/credit-accounts', { headers: getAuthHeaders() }),
                fetch(API_URL + '/api/finance/codigo-contable', { headers: getAuthHeaders() }),
                fetch(API_URL + '/api/finance/transaction-status', { headers: getAuthHeaders() }),
                fetch(API_URL + '/api/planilla-borrador', { headers: getAuthHeaders() })
            ]);

            let mergedItems: any[] = [];

            if (invoicesRes.ok) {
                const data = await invoicesRes.json();
                this.thisMonthPaid = data.thisMonthPaid || 0;
                this.thisMonthTotal = data.thisMonthTotal || 0;
                this.thisMonthTotalGross = data.thisMonthTotalGross || 0;
                this.thisMonthUnpaid = data.thisMonthUnpaid || 0;
                this.totalPages = data.totalPages || 1;
                this.totalResults = data.totalresults || 0;

                const mappedInvoices = (data.invoices || []).map((inv: any) => {
                    const localDate = parseToLocalMidnight(inv.fecha);
                    const item = {
                        ...inv,
                        fecha: localDate,
                        estadoLocal: (!inv.estadoLocal || inv.estadoLocal === 'Pendiente') ? 'Conciliado' : inv.estadoLocal,
                        isEgreso: false,
                        sortDate: localDate ? localDate.getTime() : 0,
                        isScanning: false
                    };

                    // Auto-scan if bank is missing
                    if (!item.banco && item.WHMCS_InvoiceID) {
                        this.autoEscanearPDF(item, item.WHMCS_InvoiceID);
                    } else if (item.banco && !item.cuentaDebito) {
                        item.cuentaDebito = this.buscarCuentaDebitoPorBanco(item.banco);
                    }

                    return item;
                });
                mergedItems = [...mergedItems, ...mappedInvoices];
            }

            if (egresosRes.ok) {
                const data = await egresosRes.json();
                console.log(`[FRONTEND DEBUG] Egresos recibidos: ${data.total}`, data.egresos);

                const mappedEgresos = (data.egresos || []).map((eg: any) => {
                    const localDate = parseToLocalMidnight(eg.fecha);
                    return {
                        ...eg,
                        fecha: localDate,
                        isEgreso: true,
                        montoBruto: eg.monto,
                        depositoSalida: eg.monto,
                        comision: 0,
                        sortDate: localDate ? localDate.getTime() : 0
                    };
                });
                mergedItems = [...mergedItems, ...mappedEgresos];
            }

            this.items = mergedItems.sort((a, b) => {
                const dateA = a.sortDate || 0;
                const dateB = b.sortDate || 0;
                if (dateB !== dateA) return dateB - dateA;
                return (b.id || 0) - (a.id || 0);
            });

            console.log(`[FRONTEND DEBUG] Total items combinados: ${this.items.length}`);

            if (mtRes.ok) this.movementTypes = await mtRes.json();
            if (bancosRes.ok) this.bancos = await bancosRes.json();
            if (daRes.ok) this.debitAccounts = await daRes.json();
            if (caRes.ok) this.creditAccounts = await caRes.json();
            if (ccRes.ok) this.codigosContables = await ccRes.json();
            if (tsRes.ok) this.transactionStatuses = await tsRes.json();

            // Calculate Payroll Total
            if (planillaRes.ok) {
                const data = await planillaRes.json();
                const now = new Date();
                const currentMonth = now.getMonth();
                const currentYear = now.getFullYear();

                this.totalPayrollNet = data.reduce((sum: number, emp: any) => {
                    // Calculate Bonuses
                    const bonosDetalle = emp.bonosDetalle || [];
                    const validBonos = bonosDetalle.filter((b: any) => {
                        if (b.permanente) return true;
                        if (!b.fecha) return false;
                        const bd = new Date(b.fecha);
                        return bd.getMonth() === currentMonth && bd.getFullYear() === currentYear;
                    });
                    const bonosTotal = validBonos.reduce((s: number, b: any) => s + (b.monto || 0), 0);

                    // Base Calculation
                    const sueldo = emp.sueldo || 0;
                    const baseCalculo = sueldo + bonosTotal;

                    // Horas Extras
                    const hourlyRate = (baseCalculo / 240) * 1.25;
                    const montoHorasExtras = hourlyRate * (emp.horasExtras || 0);

                    const totalIngresos = sueldo + montoHorasExtras + bonosTotal;

                    // AFP / SNP
                    let descuentoAfp = 0;
                    if (emp.tipoTrabajador === 'PLANILLA') {
                        let afpRate = 0;
                        const regimen = emp.regimenPensionario || '';
                        if (regimen.includes('SNP')) afpRate = 0.13;
                        else if (regimen.includes('AFP')) afpRate = 0.1138;

                        let baseAfp = totalIngresos;
                        if (emp.calculoAfpMinimo) baseAfp = 1130;
                        descuentoAfp = parseFloat((baseAfp * afpRate).toFixed(2));
                    }

                    // Faltas
                    const dayRate = baseCalculo / 30;
                    const hourRate = dayRate / 8;
                    const montoFaltas = parseFloat(((dayRate * (emp.faltasDias || 0)) + (hourRate * (emp.faltasHoras || 0))).toFixed(2));

                    // Total Discounts
                    let totalDescuento = descuentoAfp + (emp.adelanto || 0) + (emp.prestamo || 0) + montoFaltas + (emp.descuentoAdicional || 0);
                    totalDescuento = parseFloat(totalDescuento.toFixed(2));

                    // Net
                    let remuneracionNeta = totalIngresos - totalDescuento;
                    remuneracionNeta = parseFloat(remuneracionNeta.toFixed(2));

                    return sum + remuneracionNeta;
                }, 0);
            }

        } catch (error) {
            console.error('Error loading finance data:', error);
        } finally {
            this.loading = false;
            this.cdr.detectChanges();
        }
    }

    filters = {
        searchText: '',
        banco: '',
        tipoMov: '',
        numFactura: '',
        fecha: ''
    };

    get filteredItems(): any[] {
        return this.items.filter(it => {
            const search = this.filters.searchText.toLowerCase();
            const matchSearch = !search ||
                (it.clienteConcepto || '').toLowerCase().includes(search) ||
                (it.comercio || '').toLowerCase().includes(search) ||
                (it.categoria || '').toLowerCase().includes(search);

            const matchBank = !this.filters.banco || it.banco === this.filters.banco;

            const typeFilter = this.filters.tipoMov;
            const itemType = it.isEgreso ? it.tipoEgreso : it.tipoMovimiento;
            const matchType = !typeFilter || itemType === typeFilter;

            const ref = this.filters.numFactura.toLowerCase();
            const matchRef = !ref ||
                (it.numFactura || '').toLowerCase().includes(ref) ||
                (it.referencia || '').toLowerCase().includes(ref) ||
                (it.observacion || '').toLowerCase().includes(ref);

            const matchFecha = !this.filters.fecha ||
                (it.fecha && new Date(it.fecha).toISOString().split('T')[0] === this.filters.fecha);

            return matchSearch && matchBank && matchType && matchRef && matchFecha;
        });
    }

    get paginatedItems(): any[] {
        const items = this.filteredItems;
        if (this.pageSize === 'All') return items;
        return items.slice(0, Number(this.pageSize));
    }


    get totalBruto(): number {
        // Source of truth: Backend WHMCS Transaction Total
        if (this.thisMonthTotalGross > 0) return this.thisMonthTotalGross;
        // Fallback for filtered views if needed (optional)
        return this.filteredItems.filter(i => !i.isEgreso).reduce((sum, inv) => sum + (inv.montoBruto || 0), 0);
    }

    get totalInterbank(): number {
        const ingresos = this.filteredItems.filter(i => !i.isEgreso && i.banco === 'INTERBANK').reduce((sum, inv) => sum + (inv.depositoSalida || 0), 0);
        const egresos = this.filteredItems.filter(i => i.isEgreso && i.banco === 'INTERBANK').reduce((sum, e) => sum + (e.monto || 0), 0);
        return ingresos - egresos;
    }

    get totalBcp(): number {
        const ingresos = this.filteredItems.filter(i => !i.isEgreso && i.banco === 'BCP').reduce((sum, inv) => sum + (inv.depositoSalida || 0), 0);
        const egresos = this.filteredItems.filter(i => i.isEgreso && i.banco === 'BCP').reduce((sum, e) => sum + (e.monto || 0), 0);
        return ingresos - egresos;
    }

    get totalCajaVirtual(): number {
        const ingresos = this.filteredItems.filter(i => !i.isEgreso && i.banco === 'CAJA VIRTUAL').reduce((sum, inv) => sum + (inv.depositoSalida || 0), 0);
        const egresos = this.filteredItems.filter(i => i.isEgreso && i.banco === 'CAJA VIRTUAL').reduce((sum, e) => sum + (e.monto || 0), 0);
        return ingresos - egresos;
    }

    get balance1(): number {
        return 0; // As requested, Balance 1 should be zero
    }

    get balance2(): number {
        // Balance 2 = Total Bruto (WHMCS) - Total Payroll Net
        return (this.thisMonthTotalGross || 0) - this.totalPayrollNet;
    }

    get totalComisiones(): number {
        return this.filteredItems.filter(i => !i.isEgreso).reduce((sum, inv) => sum + (inv.comision || 0), 0);
    }

    get totalDeposito(): number {
        return this.filteredItems.filter(i => !i.isEgreso).reduce((sum, inv) => sum + (inv.depositoSalida || 0), 0);
    }

    get totalEgresos(): number {
        return this.filteredItems.filter(i => i.isEgreso).reduce((sum, e) => sum + (e.monto || 0), 0);
    }

    getCurrentMonth(): string {
        const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        return months[new Date().getMonth()] + ' ' + new Date().getFullYear();
    }

    onComisionChange(inv: any) {
        if (inv.isEgreso) return;
        inv.depositoSalida = (inv.montoBruto || 0) - (inv.comision || 0);
        this.onFieldChange(inv);
    }

    onBancoChange(inv: any) {
        if (inv.isEgreso) return;
        if (inv.banco) {
            inv.cuentaDebito = this.buscarCuentaDebitoPorBanco(inv.banco);
        }
        this.onFieldChange(inv);
    }

    async onFieldChange(inv: any) {
        if (inv.isEgreso) return;
        try {
            await fetch(API_URL + `/api/finance/invoices/${inv.localId}/metadata`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    tipoMovimiento: inv.tipoMovimiento,
                    comision: inv.comision,
                    depositoSalida: inv.depositoSalida,
                    banco: inv.banco,
                    cuentaDebito: inv.cuentaDebito,
                    cuentaCredito: inv.cuentaCredito,
                    codigoContable: inv.codigoContable,
                    estadoLocal: inv.estadoLocal
                })
            });
        } catch (error) {
            console.error('Error updating invoice metadata:', error);
        }
    }

    getEmptyEgreso() {
        const today = new Date();
        const tzOffset = today.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(today.getTime() - tzOffset)).toISOString().split('T')[0];

        return {
            fecha: localISOTime,
            monto: 0,
            banco: 'BCP',
            tipoEgreso: 'MANUAL',
            comercio: '',
            categoria: 'Otros',
            referencia: '',
            origen: 'MANUAL',
            observacion: ''
        };
    }

    nextPage() {
        if (this.currentPage < this.totalPages) {
            this.currentPage++;
            this.loadAll();
        }
    }

    prevPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.loadAll();
        }
    }

    changePageSize(event: any) {
        this.pageSize = event.target.value;
        this.currentPage = 1;
        this.loadAll();
    }

    abrirNuevoModal() {
        this.nuevoEgreso = this.getEmptyEgreso();
        this.showModal = true;
    }

    cerrarModal() {
        this.showModal = false;
    }

    async guardarEgreso() {
        if (this.nuevoEgreso.monto <= 0) {
            alert('El monto debe ser mayor a 0');
            return;
        }
        try {
            await fetch(API_URL + '/api/finance/egresos', {
                method: 'POST',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(this.nuevoEgreso)
            });
            this.cerrarModal();
            this.loadAll();
        } catch (error) {
            console.error('Error saving egreso:', error);
            alert('Error al guardar el egreso');
        }
    }

    async eliminarEgreso(id: number) {
        if (!confirm('¿Está seguro de eliminar este egreso?')) return;
        try {
            await fetch(API_URL + `/api/finance/egresos/${id}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });
            this.loadAll();
        } catch (error) {
            console.error('Error deleting egreso:', error);
            alert('Error al eliminar');
        }
    }

    buscarCuentaDebitoPorBanco(banco: string): string {
        if (!banco || !this.debitAccounts.length) return '';
        const bancoLower = banco.toLowerCase().trim();
        
        // Exact match first
        const exactMatch = this.debitAccounts.find(cd => (cd.name || '').toLowerCase() === bancoLower);
        if (exactMatch) return exactMatch.name;

        // Fuzzy match
        const cuenta = this.debitAccounts.find(cd => {
            const nombre = (cd.name || '').toLowerCase();

            if (bancoLower.includes('bcp') || bancoLower.includes('crédito') || bancoLower.includes('credito') || bancoLower.includes('yape')) {
                return nombre.includes('bcp') || nombre.includes('crédito') || nombre.includes('credito') || nombre.includes('banco de');
            }
            if (bancoLower.includes('interbank') || bancoLower.includes('plin')) {
                return nombre.includes('interbank');
            }
            if (bancoLower.includes('izipay') || bancoLower.includes('caja')) {
                return nombre.includes('izipay') || nombre.includes('caja');
            }
            return nombre.includes(bancoLower);
        });
        return cuenta ? cuenta.name : '';
    }

    async autoEscanearPDF(item: any, invoiceId: string) {
        item.isScanning = true;
        try {
            const res = await fetch(API_URL + `/api/finance/invoices/${invoiceId}/pdf-info`, {
                headers: getAuthHeaders()
            });
            const resp = await res.json();
            if (resp.success && resp.data) {
                if (resp.data.banco) item.banco = resp.data.banco;
                if (item.banco && !item.cuentaDebito) {
                    item.cuentaDebito = this.buscarCuentaDebitoPorBanco(item.banco);
                }
                // Update on server
                if (item.banco || item.cuentaDebito) {
                    this.onFieldChange(item);
                }
            }
        } catch (error) {
            console.error('Error scanning PDF:', error);
        } finally {
            item.isScanning = false;
            this.cdr.detectChanges();
        }
    }

    async openInvoiceDetail(invoiceId: number) {
        this.loadingInvoice = true;
        this.invoiceDetail = null;
        this.showInvoiceModal = true;
        try {
            const res = await fetch(API_URL + `/api/whmcs/invoice/${invoiceId}`, {
                headers: getAuthHeaders()
            });
            const data = await res.json();
            if (data.success) {
                this.invoiceDetail = data.invoice;
            } else {
                alert('No se pudo cargar la factura');
                this.showInvoiceModal = false;
            }
        } catch (error) {
            console.error('Error loading invoice detail:', error);
            alert('Error al cargar los detalles de la factura');
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

    downloadInvoicePdf(invoiceId: number) {
        const url = `${API_URL}/api/whmcs/invoice/${invoiceId}/pdf`;
        const link = document.createElement('a');
        link.href = url;
        // Since the backend sets Content-Disposition: attachment, 
        // this will trigger a download without changing the page.
        link.target = '_self';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}
