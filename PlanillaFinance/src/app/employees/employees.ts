
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { API_URL, getAuthHeaders } from '../api-config';

interface Employee {
    _id?: string;
    nombre: string;
    apellidos: string;
    dni: string;
    email?: string;
    cargo: string;
    departamento: string;
    estado: string;
    sueldo?: number;
    [key: string]: any;
}

interface EmployeeFormData {
    _id?: string;
    nombre: string;
    apellidos: string;
    dni: string;
    sexo: string;
    nacionalidad: string;
    telefono: string;
    contactoEmergencia: string;
    numeroEmergencia: string;
    fechaNacimiento: string;
    direccion: string;
    email: string;
    cargo: string;
    departamento: string;
    tipoTrabajador: string;
    regimenPensionario: string;
    sueldo: number;
    asignacionFamiliar: boolean;
    calculoAfpMinimo: boolean;
    fechaInicio: string;
    fechaFinContrato: string;
    tipoContrato: string;
    horarioTrabajo: string;
    banco: string;
    tipoCuenta: string;
    numeroCuenta: string;
    cci: string;
    nivelEducativo: string;
    estado: string;
}

@Component({
    selector: 'app-employees',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './employees.html',
    styleUrl: './employees.css'
})
export class GestionEmpleadosComponent {
    searchTerm: string = '';
    showAddModal: boolean = false;
    submitted: boolean = false;
    searchingDni: boolean = false;

    // Leave modal
    showLeaveModal: boolean = false;
    leaveReason: string = '';
    selectedEmployeeForLeave: any = null;

    // Notification modal
    showNotification: boolean = false;
    notificationMessage: string = '';
    notificationSuccess: boolean = true;

    employees: Employee[] = [];
    filteredEmployees: Employee[] = [];

    newEmployee: EmployeeFormData = {
        nombre: '', apellidos: '', dni: '', sexo: '', nacionalidad: '', telefono: '', contactoEmergencia: '', numeroEmergencia: '', fechaNacimiento: '', direccion: '',
        email: '', cargo: '', departamento: '', tipoTrabajador: 'PLANILLA', regimenPensionario: 'SNP/ONP', sueldo: 0, asignacionFamiliar: false,
        calculoAfpMinimo: false,
        fechaInicio: new Date().toISOString().split('T')[0], fechaFinContrato: '', tipoContrato: '', horarioTrabajo: '',
        banco: '', tipoCuenta: '', numeroCuenta: '', cci: '', nivelEducativo: '', estado: 'Activo'
    };

    cargos: string[] = ['Técnico', 'Administrador', 'Vendedor', 'Gerente', 'Recepcionista', 'Programador', 'Administrativo', 'Ventas', 'Gerencia', 'Soporte Técnico', 'Diseño', 'Marketing'];

    departamentosPorCargo: { [key: string]: string[] } = {
        'Técnico': ['Técnico de Soporte', 'Infraestructura', 'Soporte N2'],
        'Administrador': ['Administración General', 'Contabilidad', 'RRHH', 'Tesorería'],
        'Vendedor': ['Ventas', 'Ejecutivo Comercial', 'Asesor de Ventas'],
        'Gerente': ['Administración General', 'Gerencia General', 'Operaciones'],
        'Recepcionista': ['Atención al Cliente', 'Secretaría', 'Recepción'],
        'Programador': ['Programador Full Stack', 'Programador Backend', 'Programador Frontend', 'Programador Analytics', 'DevOps', 'Mobile Developer'],
        'Administrativo': ['RRHH', 'Contabilidad', 'Logística', 'Secretaría', 'Tesorería'],
        'Ventas': ['Ejecutivo Comercial', 'Asesor de Ventas', 'Atención al Cliente', 'Post-Venta'],
        'Gerencia': ['Gerencia General', 'Gerencia de Proyectos', 'Gerencia Operativa', 'Directorio'],
        'Soporte Técnico': ['Help Desk N1', 'Soporte N2', 'Infraestructura', 'Redes'],
        'Diseño': ['Diseño UX/UI', 'Diseño Gráfico', 'Diseño de Producto'],
        'Marketing': ['Marketing Digital', 'Community Management', 'SEO/SEM', 'Content Creator']
    };

    availableDepartamentos: string[] = [];

    constructor() {
        this.loadEmployees();
    }

    onCargoChange() {
        const selectedCargo = this.newEmployee.cargo;
        if (selectedCargo && this.departamentosPorCargo[selectedCargo]) {
            this.availableDepartamentos = this.departamentosPorCargo[selectedCargo];
        } else {
            this.availableDepartamentos = [];
        }
        if (!this.availableDepartamentos.includes(this.newEmployee.departamento)) {
            this.newEmployee.departamento = '';
        }
    }

    formatDate(dateStr: any): string {
        if (!dateStr) return '';
        try {
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return '';
            return date.toISOString().split('T')[0];
        } catch {
            return '';
        }
    }

    async loadEmployees() {
        try {
            const response = await fetch(API_URL + '/api/empleados', {
                headers: getAuthHeaders()
            });
            if (response.ok) {
                const rawData = await response.json();
                this.employees = rawData.map((emp: any) => ({
                    ...emp,
                    nombre: emp.nombre || emp.name || 'Sin Nombre',
                    apellidos: emp.apellidos || emp.surname || '',
                    cargo: emp.cargo || emp.position || 'Sin Cargo',
                    departamento: emp.departamento || emp.department || 'Sin Dept',
                    email: emp.email || '',
                    estado: emp.estado || emp.status || 'Activo',
                    dni: emp.dni || '',
                    fechaInicio: emp.fechaInicio || emp.startDate,
                    sueldo: emp.sueldo || emp.salary,
                }));
                this.filterEmployees();
            }
        } catch (error) {
            console.error('Error loading employees:', error);
        }
    }

    onDniInput() {
        setTimeout(() => {
            this.newEmployee.dni = (this.newEmployee.dni || '').toString().replace(/[^0-9]/g, '').slice(0, 8);
        }, 0);
    }

    async searchDni() {
        if (!this.newEmployee.dni || this.newEmployee.dni.length !== 8) {
            alert('Por favor ingrese un DNI válido de 8 dígitos.');
            return;
        }
        this.searchingDni = true;
        try {
            const response = await fetch(API_URL + `/api/reniec/${this.newEmployee.dni}`, {
                headers: getAuthHeaders()
            });
            if (response.ok) {
                const data = await response.json();
                this.newEmployee.nombre = data.nombres || '';
                this.newEmployee.apellidos = data.apellidos || '';
                this.newEmployee.direccion = data.direccion || this.newEmployee.direccion;
                this.newEmployee.nacionalidad = data.nacionalidad || 'Peruana';
            } else {
                throw new Error('Error en la consulta');
            }
        } catch (error) {
            console.error('Error buscar DNI:', error);
            alert('No se pudieron obtener los datos del DNI. Por favor ingrese manualmente.');
        } finally {
            this.searchingDni = false;
        }
    }

    filterEmployees() {
        this.filteredEmployees = this.employees.filter(emp =>
            (emp.nombre || '').toLowerCase().includes(this.searchTerm.toLowerCase()) ||
            (emp.cargo || '').toLowerCase().includes(this.searchTerm.toLowerCase()) ||
            (emp.departamento || '').toLowerCase().includes(this.searchTerm.toLowerCase())
        );
    }

    openAddModal() {
        this.showAddModal = true;
        this.submitted = false;
        this.newEmployee = {
            nombre: '', apellidos: '', dni: '', sexo: '', nacionalidad: '', telefono: '', contactoEmergencia: '', numeroEmergencia: '', fechaNacimiento: '', direccion: '',
            email: '', cargo: '', departamento: '', tipoTrabajador: 'PLANILLA', regimenPensionario: 'SNP/ONP', sueldo: 0, asignacionFamiliar: false,
            calculoAfpMinimo: false,
            fechaInicio: new Date().toISOString().split('T')[0], fechaFinContrato: '', tipoContrato: '', horarioTrabajo: '',
            banco: '', tipoCuenta: '', numeroCuenta: '', cci: '', nivelEducativo: '', estado: 'Activo'
        };
        this.availableDepartamentos = [];
    }

    closeAddModal() {
        this.showAddModal = false;
    }

    async saveEmployee() {
        const isEditing = !!(this.newEmployee as any)._id;
        this.submitted = true;
        if (!isEditing) {
            if (!this.newEmployee.dni || !this.newEmployee.nombre || !this.newEmployee.apellidos || !this.newEmployee.telefono || !this.newEmployee.direccion || !this.newEmployee.fechaNacimiento || !this.newEmployee.cargo || !this.newEmployee.departamento) {
                this.showNotif('Por favor complete todos los campos obligatorios en rojo.', false);
                return;
            }
        }
        try {
            const url = isEditing ? API_URL + `/api/empleados/${(this.newEmployee as any)._id}` : API_URL + '/api/empleados';
            const method = isEditing ? 'PUT' : 'POST';
            const response = await fetch(url, {
                method: method,
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(this.newEmployee)
            });
            if (response.ok) {
                this.closeAddModal();
                this.loadEmployees();
                this.showNotif(`Empleado ${isEditing ? 'actualizado' : 'registrado'} exitosamente.`, true);
            } else {
                const err = await response.json();
                this.showNotif('Error: ' + (err.error || 'Desconocido'), false);
            }
        } catch (error) {
            this.showNotif('Error de conexión.', false);
        }
    }

    showNotif(message: string, success: boolean) {
        this.notificationMessage = message;
        this.notificationSuccess = success;
        this.showNotification = true;
        setTimeout(() => this.showNotification = false, 2500);
    }

    closeNotification() { this.showNotification = false; }

    viewEmployee(employee: any) {
        this.submitted = false;
        this.newEmployee = { ...employee, fechaNacimiento: this.formatDate(employee.fechaNacimiento), fechaInicio: this.formatDate(employee.fechaInicio), fechaFinContrato: this.formatDate(employee.fechaFinContrato) };
        this.showAddModal = true;
        if (this.newEmployee.cargo && this.departamentosPorCargo[this.newEmployee.cargo]) {
            this.availableDepartamentos = this.departamentosPorCargo[this.newEmployee.cargo];
        } else {
            this.availableDepartamentos = [this.newEmployee.departamento];
        }
    }

    editEmployee(employee: any) {
        this.submitted = false;
        this.newEmployee = { ...employee, fechaNacimiento: this.formatDate(employee.fechaNacimiento), fechaInicio: this.formatDate(employee.fechaInicio), fechaFinContrato: this.formatDate(employee.fechaFinContrato) };
        this.showAddModal = true;
        if (this.newEmployee.cargo && this.departamentosPorCargo[this.newEmployee.cargo]) {
            this.availableDepartamentos = this.departamentosPorCargo[this.newEmployee.cargo];
        } else {
            this.availableDepartamentos = [this.newEmployee.departamento];
        }
    }

    openLeaveModal(employee: any) {
        this.selectedEmployeeForLeave = employee;
        this.leaveReason = '';
        this.showLeaveModal = true;
    }

    closeLeaveModal() {
        this.showLeaveModal = false;
        this.selectedEmployeeForLeave = null;
        this.leaveReason = '';
    }

    async confirmLeave() {
        if (!this.selectedEmployeeForLeave) return;
        if (!this.leaveReason.trim()) {
            alert('Por favor ingrese el motivo de la baja');
            return;
        }
        try {
            const response = await fetch(API_URL + `/api/empleados/${this.selectedEmployeeForLeave._id}`, {
                method: 'DELETE',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ motivo: this.leaveReason })
            });
            if (response.ok) {
                const nombreEmpleado = this.selectedEmployeeForLeave.nombre;
                this.closeLeaveModal();
                this.loadEmployees();
                this.showNotif(`Empleado ${nombreEmpleado} dado de baja y archivado.`, true);
            } else {
                const errorData = await response.json().catch(() => ({ error: 'Error desconocido' }));
                this.showNotif('Error: ' + (errorData.error || 'No se pudo procesar la baja'), false);
            }
        } catch (error) {
            console.error('Error de conexión:', error);
            this.showNotif('Error de conexión con el servidor.', false);
        }
    }
}
