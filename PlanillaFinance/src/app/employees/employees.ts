
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { API_URL } from '../api-config';

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
    // ... others
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

    employees: Employee[] = [];
    filteredEmployees: Employee[] = [];

    newEmployee: EmployeeFormData = {
        // Personal Info
        nombre: '',
        apellidos: '',
        dni: '',
        sexo: '',
        nacionalidad: '',
        telefono: '',
        contactoEmergencia: '',
        numeroEmergencia: '',
        fechaNacimiento: '',
        direccion: '',

        email: '',
        cargo: '',
        departamento: '',
        tipoTrabajador: 'PLANILLA',
        regimenPensionario: 'SNP/ONP',
        sueldo: 0,
        asignacionFamiliar: false,
        calculoAfpMinimo: false,

        fechaInicio: new Date().toISOString().split('T')[0],
        fechaFinContrato: '',
        tipoContrato: '',
        horarioTrabajo: '',

        banco: '',
        tipoCuenta: '',
        numeroCuenta: '',
        cci: '',

        nivelEducativo: '',

        estado: 'Activo'
    };

    // List of available roles
    cargos: string[] = [
        'Técnico',
        'Administrador',
        'Vendedor',
        'Gerente',
        'Recepcionista',
        'Programador',
        'Administrativo',
        'Ventas',
        'Gerencia',
        'Soporte Técnico',
        'Diseño',
        'Marketing'
    ];

    // Map of Departments per Role
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

    // Current available departments options
    availableDepartamentos: string[] = [];

    constructor() {
        this.loadEmployees();
    }

    onCargoChange() {
        // Update available departments based on selected Cargo
        const selectedCargo = this.newEmployee.cargo;
        if (selectedCargo && this.departamentosPorCargo[selectedCargo]) {
            this.availableDepartamentos = this.departamentosPorCargo[selectedCargo];
        } else {
            this.availableDepartamentos = [];
        }
        // Reset departamento selection if it's no longer valid
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
            const response = await fetch(API_URL + '/api/empleados');
            if (response.ok) {
                const rawData = await response.json();
                console.log('Raw data:', rawData);

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

                console.log('Normalized employees:', this.employees);
                this.filterEmployees();
            } else {
                console.error('Failed to load employees:', response.statusText);
            }
        } catch (error) {
            console.error('Error loading employees:', error);
        }
    }

    async searchDni() {
        if (!this.newEmployee.dni || this.newEmployee.dni.length !== 8) {
            alert('Por favor ingrese un DNI válido de 8 dígitos.');
            return;
        }

        try {
            const response = await fetch(API_URL + `/api/reniec/${this.newEmployee.dni}`);

            if (!response.ok) {
                throw new Error('Error en la consulta');
            }

            const data = await response.json();

            this.newEmployee.nombre = data.nombres || '';
            this.newEmployee.apellidos = `${data.apellidoPaterno || ''} ${data.apellidoMaterno || ''}`.trim();


        } catch (error) {
            console.error('Error buscar DNI:', error);
            alert('No se pudieron obtener los datos del DNI. Por favor ingrese manualmente.');
        }
    }

    filterEmployees() {
        this.filteredEmployees = this.employees.filter(emp =>
            (emp.nombre || '').toLowerCase().includes(this.searchTerm.toLowerCase()) ||
            (emp.cargo || '').toLowerCase().includes(this.searchTerm.toLowerCase()) ||
            (emp.departamento || '').toLowerCase().includes(this.searchTerm.toLowerCase())
        );
    }

    // Interface update (if it was defined near top, but here assuming I edit openAddModal)
    openAddModal() {
        this.showAddModal = true;
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
        if (
            this.newEmployee.dni &&
            this.newEmployee.nombre &&
            this.newEmployee.apellidos &&
            this.newEmployee.telefono &&
            this.newEmployee.direccion &&
            this.newEmployee.fechaNacimiento &&
            this.newEmployee.cargo &&
            this.newEmployee.departamento
        ) {
            try {
                const isEditing = !!(this.newEmployee as any)._id;
                const url = isEditing
                    ? API_URL + `/api/empleados/${(this.newEmployee as any)._id}`
                    : API_URL + '/api/empleados';

                const method = isEditing ? 'PUT' : 'POST';

                const response = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(this.newEmployee)
                });

                if (response.ok) {
                    alert(`Empleado ${isEditing ? 'actualizado' : 'registrado'} exitosamente.`);
                    this.closeAddModal();
                    this.loadEmployees();
                } else {
                    const err = await response.json();
                    alert(`Error al ${isEditing ? 'actualizar' : 'registrar'}: ` + (err.error || 'Desconocido'));
                }
            } catch (error) {
                console.error('Error saving:', error);
                alert('Error de conexión.');
            }
        } else {
            alert('Por favor complete todos los campos obligatorios:\n- DNI\n- Nombre y Apellidos\n- Celular\n- Dirección\n- Fecha de Nacimiento\n- Departamento y Cargo');
        }
    }

    viewEmployee(employee: any) {
        this.newEmployee = {
            ...employee,
            fechaNacimiento: this.formatDate(employee.fechaNacimiento),
            fechaInicio: this.formatDate(employee.fechaInicio),
            fechaFinContrato: this.formatDate(employee.fechaFinContrato)
        };
        this.showAddModal = true;
        // Populate departments for the selected employee's role so it shows correctly
        if (this.newEmployee.cargo && this.departamentosPorCargo[this.newEmployee.cargo]) {
            this.availableDepartamentos = this.departamentosPorCargo[this.newEmployee.cargo];
        } else {
            // If cargo not in list (e.g. imported legacy data), keep it as is or add to list?
            // For now, allow viewing current value even if not in list, but dropdown might be empty options with value set
            this.availableDepartamentos = [this.newEmployee.departamento];
        }
        console.log('Visualizando empleado', this.newEmployee);
    }

    editEmployee(employee: any) {
        this.newEmployee = {
            ...employee,
            fechaNacimiento: this.formatDate(employee.fechaNacimiento),
            fechaInicio: this.formatDate(employee.fechaInicio),
            fechaFinContrato: this.formatDate(employee.fechaFinContrato)
        };
        this.showAddModal = true;
        // Populate departments for editing
        if (this.newEmployee.cargo && this.departamentosPorCargo[this.newEmployee.cargo]) {
            this.availableDepartamentos = this.departamentosPorCargo[this.newEmployee.cargo];
        } else {
            this.availableDepartamentos = [this.newEmployee.departamento];
        }
    }

    async deleteEmployee(employee: any) {
        if (confirm(`¿Está seguro de dar de baja a ${employee.nombre}?`)) {
            try {
                const response = await fetch(API_URL + `/api/empleados/${employee._id}`, {
                    method: 'DELETE'
                });

                if (response.ok) {
                    this.loadEmployees();
                } else {
                    alert('Error al dar de baja');
                }
            } catch (error) {
                console.error('Error deleting:', error);
            }
        }
    }
}
