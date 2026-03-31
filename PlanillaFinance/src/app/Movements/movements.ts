import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { API_URL, getAuthHeaders } from '../api-config';
import { NotificationService } from '../shared/notification.service';
import { AuditService } from '../shared/audit.service';

interface Movement {
    _id?: string; // actually subdoc id usually, but here we might need parent emp id + subdoc id logic
    empleadoId: string;
    empleadoNombre: string;
    empleadoCargo: string;
    tipo: string;
    fecha: string;
    monto: number;
    cuotas?: number;
    observacion?: string;
    // Helper to identify original array item
    originalIndex?: number;
}

@Component({
    selector: 'app-movements',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './movements.html',
    styleUrl: './movements.css'
})
export class MovimientosComponent {
    employees: any[] = [];
    allMovements: Movement[] = [];
    filteredMovements: Movement[] = [];

    searchTerm: string = '';
    filterType: string = '';
    selectedMonth: string = new Date().toISOString().slice(0, 7); // Default current month YYYY-MM

    totalAdelantos: number = 0;
    adelantosPorEmpleado: { nombre: string; total: number }[] = [];

    showModal: boolean = false;
    newMovement = {
        empleadoId: '',
        tipo: 'ADELANTO',
        monto: 0,
        fecha: new Date().toISOString().split('T')[0],
        cuotas: 1,
        observacion: ''
    };

    constructor(
        private notification: NotificationService,
        private audit: AuditService
    ) {
        this.loadData();
    }

    async loadData() {
        try {
            // Fetch Employees first (for name mapping)
            const empResponse = await fetch(API_URL + '/api/empleados', {
                headers: getAuthHeaders()
            });
            if (empResponse.ok) {
                this.employees = await empResponse.json();
            }

            let query = '';
            if (this.selectedMonth) {
                const [year, month] = this.selectedMonth.split('-');
                // Convert month to number to remove leading zero if necessary (e.g., '03' -> 3), 
                // though the backend handles padded strings too.
                query = `?mes=${parseInt(month)}&anio=${year}`;
            }

            // Fetch all movements in parallel
            const [adelantosRes, prestamosRes, movilidadRes, viaticosRes] = await Promise.all([
                fetch(API_URL + `/api/adelantos${query}`, { headers: getAuthHeaders() }),
                fetch(API_URL + `/api/prestamos${query}`, { headers: getAuthHeaders() }),
                fetch(API_URL + `/api/movilidad${query}`, { headers: getAuthHeaders() }),
                fetch(API_URL + `/api/viaticos${query}`, { headers: getAuthHeaders() })
            ]);

            const adelantos = adelantosRes.ok ? await adelantosRes.json() : [];
            const prestamos = prestamosRes.ok ? await prestamosRes.json() : [];
            const movilidad = movilidadRes.ok ? await movilidadRes.json() : [];
            const viaticos = viaticosRes.ok ? await viaticosRes.json() : [];

            this.processMovements(adelantos, prestamos, movilidad, viaticos);

        } catch (error) {
            console.error('Error loading data:', error);
        }
    }

    processMovements(adelantos: any[], prestamos: any[], movilidad: any[], viaticos: any[]) {
        this.allMovements = [];

        // Helper to find employee name
        const getEmpInfo = (item: any) => {
            if (item.nombreEmpleado) return { name: item.nombreEmpleado, cargo: item.cargo || '-' };
            const emp = this.employees.find(e => String(e._id) === String(item.empleadoId) || String(e.dni) === String(item.dni));
            return emp ? { name: `${emp.nombre} ${emp.apellidos}`, cargo: emp.cargo } : { name: 'Desconocido', cargo: '-' };
        };

        // Map Adelantos
        adelantos.forEach(item => {
            const info = getEmpInfo(item);
            this.allMovements.push({
                _id: item._id,
                empleadoId: item.empleadoId,
                empleadoNombre: info.name,
                empleadoCargo: info.cargo,
                tipo: 'ADELANTO',
                fecha: item.fechaSolicitud || item.fecha || item.createdAt,
                monto: item.monto,
                observacion: item.observaciones || item.observacion || item.motivo
            });
        });

        // Map Prestamos
        prestamos.forEach(item => {
            const info = getEmpInfo(item);
            this.allMovements.push({
                _id: item._id,
                empleadoId: item.empleadoId,
                empleadoNombre: info.name,
                empleadoCargo: info.cargo,
                tipo: 'PRESTAMO',
                fecha: item.fechaSolicitud || item.fecha || item.createdAt,
                monto: item.monto,
                cuotas: item.cuotaNumero,
                observacion: item.observaciones || item.observacion
            });
        });

        // Map Movilidad
        movilidad.forEach(item => {
            const info = getEmpInfo(item);
            this.allMovements.push({
                _id: item._id,
                empleadoId: item.empleadoId,
                empleadoNombre: info.name,
                empleadoCargo: info.cargo,
                tipo: 'MOVILIDAD',
                fecha: item.fecha || item.createdAt,
                monto: item.monto,
                observacion: item.observacion || item.detalle
            });
        });

        // Map Viaticos
        viaticos.forEach(item => {
            const info = getEmpInfo(item);
            this.allMovements.push({
                _id: item._id,
                empleadoId: item.empleadoId,
                empleadoNombre: info.name,
                empleadoCargo: info.cargo,
                tipo: 'VIATICOS',
                fecha: item.fecha || item.createdAt,
                monto: item.monto,
                observacion: item.observacion || item.concepto
            });
        });

        // Sort by date desc
        this.allMovements.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
        this.filterMovements();
    }

    filterMovements() {
        this.filteredMovements = this.allMovements.filter(m => {
            const matchesSearch = (m.empleadoNombre || '').toLowerCase().includes(this.searchTerm.toLowerCase()) ||
                (m.observacion || '').toLowerCase().includes(this.searchTerm.toLowerCase());
            const matchesType = this.filterType ? m.tipo === this.filterType : true;

            // Date Filter (Frontend fallback/additional check)
            let matchesMonth = true;
            if (this.selectedMonth && m.fecha) {
                matchesMonth = m.fecha.startsWith(this.selectedMonth);
            } else if (this.selectedMonth && !m.fecha) {
                matchesMonth = false; // Filter is active, but record has no date
            }

            return matchesSearch && matchesType && matchesMonth;
        });
        
        this.calculateTotals();
    }

    calculateTotals() {
        let adelantosFiltered = this.filteredMovements.filter(m => m.tipo === 'ADELANTO');
        
        this.totalAdelantos = adelantosFiltered.reduce((sum, m) => sum + m.monto, 0);

        const map = new Map<string, number>();
        adelantosFiltered.forEach(m => {
            const current = map.get(m.empleadoNombre) || 0;
            map.set(m.empleadoNombre, current + m.monto);
        });

        this.adelantosPorEmpleado = Array.from(map.entries()).map(([nombre, total]) => ({ nombre, total }));
        this.adelantosPorEmpleado.sort((a, b) => b.total - a.total);
    }

    clearFilters() {
        this.searchTerm = '';
        this.filterType = '';
        this.selectedMonth = ''; // Clears the month/year filter
        this.loadData(); // Re-fetch all data without the mes/anio filter
    }

    openModal() {
        this.newMovement = {
            empleadoId: '',
            tipo: 'ADELANTO',
            monto: 0,
            fecha: new Date().toISOString().split('T')[0],
            cuotas: 1,
            observacion: ''
        };
        this.showModal = true;
    }

    closeModal() {
        this.showModal = false;
    }

    isValidForm() {
        return this.newMovement.empleadoId && this.newMovement.monto > 0 && this.newMovement.fecha;
    }

    async saveMovement() {
        if (!this.isValidForm()) return;

        const emp = this.employees.find(e => String(e._id) === String(this.newMovement.empleadoId));

        const payload = {
            empleadoId: this.newMovement.empleadoId,
            dni: emp ? emp.dni : '',
            monto: this.newMovement.monto,
            fecha: this.newMovement.fecha,
            observaciones: this.newMovement.observacion || '',
            nombreEmpleado: emp ? `${emp.nombre} ${emp.apellidos}` : '',
            cargo: emp ? emp.cargo : '',
            departamento: emp ? emp.departamento : '',
            // Specific fields
            cuotas: this.newMovement.tipo === 'PRESTAMO' ? this.newMovement.cuotas : undefined,
            detalle: this.newMovement.tipo === 'MOVILIDAD' ? this.newMovement.observacion : undefined,
            concepto: this.newMovement.tipo === 'VIATICOS' ? this.newMovement.observacion : undefined
        };

        let endpoint = '';
        switch (this.newMovement.tipo) {
            case 'ADELANTO': endpoint = 'adelantos'; break;
            case 'PRESTAMO': endpoint = 'prestamos'; break;
            case 'MOVILIDAD': endpoint = 'movilidad'; break;
            case 'VIATICOS': endpoint = 'viaticos'; break;
            default: 
                this.notification.error('Tipo de movimiento no soportado');
                return;
        }

        try {
            const response = await fetch(API_URL + `/api/${endpoint}`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                this.audit.log(
                    `Registró ${this.newMovement.tipo.toLowerCase()}: ${emp ? emp.nombre : 'Desconocido'}`,
                    'Movimientos',
                    `Monto: S/ ${this.newMovement.monto} | Fecha: ${this.newMovement.fecha}`
                );
                this.notification.success('Movimiento registrado con éxito.');
                this.closeModal();
                this.loadData();
            } else {
                this.notification.error('Error al guardar el movimiento');
            }
        } catch (error) {
            console.error('Error saving:', error);
            this.notification.error('Error de conexión');
        }
    }

    async deleteMovement(move: Movement) {
        if (!await this.notification.confirm(`¿Estás seguro de eliminar este ${move.tipo.toLowerCase()}?`, 'Confirmar Eliminación')) return;

        let endpoint = '';
        switch (move.tipo) {
            case 'ADELANTO': endpoint = 'adelantos'; break;
            case 'PRESTAMO': endpoint = 'prestamos'; break;
            case 'MOVILIDAD': endpoint = 'movilidad'; break;
            case 'VIATICOS': endpoint = 'viaticos'; break;
            default: return;
        }

        try {
            const response = await fetch(API_URL + `/api/${endpoint}/${move._id}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });

            if (response.ok) {
                this.audit.log(
                    `Eliminó ${move.tipo.toLowerCase()}: ${move.empleadoNombre}`,
                    'Movimientos',
                    `Monto anterior: S/ ${move.monto}`
                );
                this.notification.success('Movimiento eliminado correctamente.');
                this.loadData();
            } else {
                this.notification.error('No se pudo eliminar el movimiento.');
            }
        } catch (error) {
            console.error('Error deleting:', error);
            this.notification.error('Error de conexión al eliminar.');
        }
    }
}
