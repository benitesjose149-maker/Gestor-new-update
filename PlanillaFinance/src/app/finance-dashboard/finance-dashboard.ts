
import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { API_URL } from '../api-config';

@Component({
    selector: 'app-finance-dashboard',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './finance-dashboard.html',
    styleUrl: './finance-dashboard.css'
})
export class FinanceDashboardComponent implements OnInit {

    loading: boolean = false;
    invoices: any[] = [];
    totalResults: number = 0;
    thisMonthPaid: number = 0;
    thisMonthTotal: number = 0;

    // Lookup tables
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
            const [invoicesRes, mtRes, bancosRes, daRes, caRes, ccRes, tsRes] = await Promise.all([
                fetch(API_URL + '/api/whmcs/invoices?limitnum=250'),
                fetch(API_URL + '/api/finance/movement-types'),
                fetch(API_URL + '/api/finance/bancos'),
                fetch(API_URL + '/api/finance/debit-accounts'),
                fetch(API_URL + '/api/finance/credit-accounts'),
                fetch(API_URL + '/api/finance/codigo-contable'),
                fetch(API_URL + '/api/finance/transaction-status')
            ]);

            if (invoicesRes.ok) {
                const data = await invoicesRes.json();
                this.thisMonthPaid = data.thisMonthPaid || 0;
                this.thisMonthTotal = data.thisMonthTotal || 0;
                this.invoices = (data.invoices || []);
                this.totalResults = data.totalresults || 0;
            }

            if (mtRes.ok) this.movementTypes = await mtRes.json();
            if (bancosRes.ok) this.bancos = await bancosRes.json();
            if (daRes.ok) this.debitAccounts = await daRes.json();
            if (caRes.ok) this.creditAccounts = await caRes.json();
            if (ccRes.ok) this.codigosContables = await ccRes.json();
            if (tsRes.ok) this.transactionStatuses = await tsRes.json();

        } catch (error) {
            console.error('Error loading finance data:', error);
        } finally {
            this.loading = false;
            this.cdr.detectChanges();
        }
    }

    get totalBruto(): number {
        return this.invoices.reduce((sum, inv) => sum + (inv.montoBruto || 0), 0);
    }

    get totalInterbank(): number {
        return this.invoices.filter(inv => inv.banco === 'INTERBANK').reduce((sum, inv) => sum + (inv.depositoSalida || 0), 0);
    }

    get totalBcp(): number {
        return this.invoices.filter(inv => inv.banco === 'BCP').reduce((sum, inv) => sum + (inv.depositoSalida || 0), 0);
    }

    get totalCajaVirtual(): number {
        return this.invoices.filter(inv => inv.banco === 'CAJA VIRTUAL').reduce((sum, inv) => sum + (inv.depositoSalida || 0), 0);
    }

    get balance1(): number {
        return this.totalInterbank + this.totalBcp;
    }

    get balance2(): number {
        return this.totalBruto - (this.totalInterbank + this.totalBcp + this.totalCajaVirtual);
    }

    get totalComisiones(): number {
        return this.invoices.reduce((sum, inv) => sum + (inv.comision || 0), 0);
    }

    get totalDeposito(): number {
        return this.invoices.reduce((sum, inv) => sum + (inv.depositoSalida || 0), 0);
    }

    getCurrentMonth(): string {
        const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        return months[new Date().getMonth()] + ' ' + new Date().getFullYear();
    }

    onComisionChange(inv: any) {
        inv.depositoSalida = (inv.montoBruto || 0) - (inv.comision || 0);
        this.onFieldChange(inv);
    }

    async onFieldChange(inv: any) {
        try {
            await fetch(API_URL + `/api/finance/invoices/${inv.localId}/metadata`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
}
