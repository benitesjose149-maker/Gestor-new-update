import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { API_URL, getAuthHeaders } from '../api-config';

@Component({
    selector: 'app-attendance',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './attendance.html',
    styleUrl: './attendance.css'
})
export class AttendanceComponent implements OnInit {

    today: Date = new Date();
    totalEmployees: number = 0;
    presentToday: number = 0;
    lateToday: number = 0;
    absentToday: number = 0;
    searchText: string = '';
    attendanceData: any[] = [];
    employees: any[] = [];

    displayedData: any[] = [];

    isModalOpen: boolean = false;
    selectedEmployee: any = null;
    selectedEmployeeHistory: any[] = [];

    isJustifyModalOpen: boolean = false;
    selectedEmployeeForJustify: any = null;
    justificationData = {
        reason: '',
        documentType: 'Certificado Médico'
    };

    isObservationModalOpen: boolean = false;
    selectedEmployeeForObservation: any = null;
    observationText: string = '';

    constructor() { }

    ngOnInit() {
        this.loadRealAttendance();
    }

    async loadRealAttendance() {
        try {
            console.log('%c[Attendance] 📡 Iniciando carga de datos...', 'color: #00bcd4; font-weight: bold;');
            const todayStr = new Date().toISOString().split('T')[0];
            const timestamp = new Date().getTime();

            console.log('[Attendance] Solicitando empleados...');
            const empRes = await fetch(`${API_URL}/api/empleados?t=${timestamp}`, { headers: getAuthHeaders() });
            console.log('[Attendance] Empleados Status:', empRes.status);

            if (empRes.ok) {
                this.employees = await empRes.json();
                console.log('%c[Attendance] 📦 DATOS RECIBIDOS DEL SERVIDOR:', 'color: #ff9800;', this.employees);
                console.log(`%c[Attendance] ✅ ${this.employees.length} empleados cargados`, 'color: #4caf50;');

                this.processRealLogs([]);
            } else {
                const errText = await empRes.text();
                console.error('[Attendance] ❌ Error en empleados:', empRes.status, errText);
            }

            console.log('[Attendance] Solicitando marcas del biométrico...');
            const logsRes = await fetch(`${API_URL}/api/attendance/logs?date=${todayStr}&t=${timestamp}`, { headers: getAuthHeaders() });

            if (logsRes.ok) {
                const logs = await logsRes.json();
                console.log(`[Attendance] 📊 ${logs.length} marcas encontradas para hoy`);
                this.processRealLogs(logs);
            }
        } catch (error) {
            console.error('%c[Attendance] 🚨 ERROR CRÍTICO:', 'color: white; background: red; padding: 5px;', error);
        }
    }
    processRealLogs(logs: any[]) {
        const attendanceMap = new Map<number, any>();

        this.employees.forEach(emp => {
            const key = emp.biometricId !== null && emp.biometricId !== undefined ? emp.biometricId : emp.id;
            attendanceMap.set(key, {
                id: emp.id,
                name: `${emp.nombre} ${emp.apellidos}`,
                role: emp.cargo || 'Personal',
                department: emp.departamento || '-',
                clockIn: '-- : --',
                clockOut: '-- : --',
                status: 'Falta',
                shift: `${emp.entryTime || '09:00'} - ${emp.exitTime || '18:00'}`,
                observation: '',
                rawEntry: null,
                rawExit: null,
                expectedEntry: emp.entryTime || '09:00'
            });
        });

        logs.forEach(log => {
            const userId = log.USERID;
            if (attendanceMap.has(userId)) {
                const emp = attendanceMap.get(userId);
                const checkTime = new Date(log.CHECKTIME);
                const timeStr = checkTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

                if (log.CHECKTYPE === 0 || !emp.rawEntry) {
                    if (!emp.rawEntry || checkTime < emp.rawEntry) {
                        emp.rawEntry = checkTime;
                        emp.clockIn = timeStr;
                    }
                }
                if (log.CHECKTYPE === 1 || !emp.rawExit) {
                    if (!emp.rawExit || checkTime > emp.rawExit) {
                        emp.rawExit = checkTime;
                        emp.clockOut = timeStr;
                    }
                }
            }
        });

        const finalData = Array.from(attendanceMap.values()).map(emp => {
            if (emp.rawEntry) {
                const [expH, expM] = emp.expectedEntry.split(':').map(Number);
                const entryH = emp.rawEntry.getHours();
                const entryM = emp.rawEntry.getMinutes();

                if (entryH < expH || (entryH === expH && entryM <= expM + 10)) {
                    emp.status = 'Puntual';
                } else {
                    emp.status = 'Tarde';
                }
            }
            emp.totalHours = this.calculateWorkedHours(emp.clockIn, emp.clockOut);
            return emp;
        });
        this.attendanceData = finalData;
        this.calculateStats(this.attendanceData);
        this.filterData();
    }
    convertToMinutes(time: string): number {
        if (time === '-- : --') return 0;

        const [hourMin, period] = time.split(' ');
        let [hours, minutes] = hourMin.split(':').map(Number);

        if (period === 'PM' && hours !== 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;

        return (hours * 60) + minutes;
    }
    calculateWorkedHours(clockIn: string, clockOut: string): string {

        if (clockIn === '-- : --' || clockOut === '-- : --') {
            return '0h 0m';
        }
        const inMinutes = this.convertToMinutes(clockIn);
        const outMinutes = this.convertToMinutes(clockOut);

        let workedMinutes = outMinutes - inMinutes;

        workedMinutes -= 60;

        if (workedMinutes < 0) workedMinutes = 0;

        const hours = Math.floor(workedMinutes / 60);
        const minutes = workedMinutes % 60;

        return `${hours}h ${minutes}m`;
    }

    openEmployeeModal(emp: any) {
        this.selectedEmployee = emp;
        this.selectedEmployeeHistory = [];
        this.isModalOpen = true;
    }

    closeModal() {
        this.isModalOpen = false;
        this.selectedEmployee = null;
        this.selectedEmployeeHistory = [];
    }

    openJustifyModal(emp: any) {
        this.selectedEmployeeForJustify = emp;
        this.isJustifyModalOpen = true;
    }

    closeJustifyModal() {
        this.isJustifyModalOpen = false;
        this.selectedEmployeeForJustify = null;
        this.justificationData = { reason: '', documentType: 'Certificado Médico' };
    }

    submitJustification() {
        if (this.selectedEmployeeForJustify) {
            const emp = this.attendanceData.find(e => e.id === this.selectedEmployeeForJustify.id);
            if (emp) emp.status = 'Justificado';

            this.closeJustifyModal();
            this.calculateStats(this.attendanceData);
            this.filterData();
        }
    }

    exportEmployeeReport(emp: any) {
        const header = "Fecha,Empleado,Entrada,Salida,Total Horas,Estado\n";
        const row = `${new Date().toLocaleDateString()},${emp.name},${emp.clockIn},${emp.clockOut},${emp.totalHours},${emp.status}\n`;

        const blob = new Blob([header + row], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.setAttribute("href", url);
        link.setAttribute("download", `Reporte_Asistencia_${emp.name.replace(/\s+/g, '_')}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        console.log(`Reporte descargado para ${emp.name}`);
    }


    openObservationModal(emp: any) {
        this.selectedEmployeeForObservation = emp;
        this.observationText = emp.observation || '';
        this.isObservationModalOpen = true;
    }

    closeObservationModal() {
        this.isObservationModalOpen = false;
        this.selectedEmployeeForObservation = null;
        this.observationText = '';
    }

    saveObservation() {
        if (this.selectedEmployeeForObservation) {
            const emp = this.attendanceData.find(e => e.id === this.selectedEmployeeForObservation.id);
            if (emp) {
                emp.observation = this.observationText;
            }
            this.closeObservationModal();
        }
    }



    calculateStats(dataToProcess: any[]) {
        this.totalEmployees = dataToProcess.length > 0 ? dataToProcess.length : this.employees.length;

        this.presentToday = dataToProcess.filter(e => e.status === 'Puntual' || e.status === 'Tarde' || e.status === 'Justificado').length;
        this.lateToday = dataToProcess.filter(e => e.status === 'Tarde').length;
        this.absentToday = this.totalEmployees - this.presentToday;
    }

    filterData() {
        if (!this.searchText) {
            this.displayedData = [...this.attendanceData];
        } else {
            const lowerQuery = this.searchText.toLowerCase();
            this.displayedData = this.attendanceData.filter(emp =>
                emp.name.toLowerCase().includes(lowerQuery) ||
                emp.role.toLowerCase().includes(lowerQuery) ||
                emp.department.toLowerCase().includes(lowerQuery)
            );
        }
    }

    getInitials(name: string): string {
        return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    }
}