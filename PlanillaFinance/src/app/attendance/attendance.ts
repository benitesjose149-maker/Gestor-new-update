import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";

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
    mockAttendanceData = [
        {
            id: 1,
            name: 'Jose Benites',
            role: 'Desarrollador Senior',
            department: 'Tecnología',
            clockIn: '08:30 AM',
            clockOut: '06:00 PM',
            totalHours: '',
            status: 'Puntual',
            shift: '09:00 - 18:00',
            observation: ''
        },
        {
            id: 2,
            name: 'Marcos VillaLobo',
            role: 'Especialista en Mkt',
            department: 'Marketing',
            clockIn: '09:15 AM',
            clockOut: '06:00 PM',
            totalHours: '',
            status: 'Tarde',
            shift: '09:00 - 18:00',
            observation: ''
        },
        {
            id: 3,
            name: 'Carlos Bramont',
            role: 'Ejecutivo de Cuentas',
            department: 'Ventas',
            clockIn: '08:58 AM',
            clockOut: '05:30 PM',
            totalHours: '',
            status: 'Puntual',
            shift: '09:00 - 18:00',
            observation: ''
        },
        {
            id: 4,
            name: 'María Fernandez',
            role: 'Gestora Financiera',
            department: 'Administración',
            clockIn: '-- : --',
            clockOut: '-- : --',
            totalHours: '',
            status: 'Falta',
            shift: '09:00 - 18:00',
            observation: ''
        },
        {
            id: 5,
            name: 'Luis Suarez',
            role: 'Soporte Técnico',
            department: 'Tecnología',
            clockIn: '09:01 AM',
            clockOut: '06:15 PM',
            totalHours: '',
            status: 'Puntual',
            shift: '09:00 - 18:00',
            observation: ''
        }
    ];

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

        this.mockAttendanceData = this.mockAttendanceData.map(emp => ({
            ...emp,
            totalHours: this.calculateWorkedHours(emp.clockIn, emp.clockOut)
        }));

        this.calculateStats(this.mockAttendanceData);
        this.displayedData = [...this.mockAttendanceData];
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
        this.selectedEmployeeHistory = this.generateMonthlyHistory(emp);
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
            const emp = this.mockAttendanceData.find(e => e.id === this.selectedEmployeeForJustify.id);
            if (emp) emp.status = 'Justificado';

            console.log('Justificación procesada para:', this.selectedEmployeeForJustify.name);
            this.closeJustifyModal();
            this.calculateStats(this.mockAttendanceData);
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
            const emp = this.mockAttendanceData.find(e => e.id === this.selectedEmployeeForObservation.id);
            if (emp) {
                emp.observation = this.observationText;
            }
            console.log('Observación guardada.');
            this.closeObservationModal();
        }
    }

    generateMonthlyHistory(emp: any): any[] {
        const history = [];
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const currentDate = now.getDate();

        const feriadosPeru = [
            '0-1', '3-2', '3-3', '4-1', '5-29',
            '6-28', '6-29', '7-30', '9-8',
            '10-1', '11-8', '11-25'
        ];

        for (let day = 1; day <= currentDate; day++) {
            const dateOfRecord = new Date(year, month, day);
            const dayOfWeek = dateOfRecord.getDay();

            const isFeriado = feriadosPeru.includes(`${month}-${day}`);
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

            let dayStatus = 'Puntual';
            let clockIn = '';
            let clockOut = '';
            let total = '';

            if (!isWeekend && !isFeriado) {

                const inMin = Math.floor(Math.random() * 30) + 45;
                const inHour = inMin >= 60 ? 9 : 8;
                const realInMin = inMin % 60;

                const outMin = Math.floor(Math.random() * 45);

                const formatTime = (h: number, m: number, ampm: string) =>
                    `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;

                clockIn = formatTime(inHour, realInMin, 'AM');
                clockOut = formatTime(6, outMin, 'PM');

                total = this.calculateWorkedHours(clockIn, clockOut);

                if (inHour === 9 && realInMin > 5) {
                    dayStatus = 'Tarde';
                }
            }

            if (isWeekend) {
                dayStatus = 'Descanso';
                clockIn = '-- : --';
                clockOut = '-- : --';
                total = '0h 0m';
            } else if (isFeriado) {
                dayStatus = 'Feriado';
                clockIn = '-- : --';
                clockOut = '-- : --';
                total = '0h 0m';
            }

            history.push({
                date: dateOfRecord,
                clockIn,
                clockOut,
                totalHours: total,
                status: dayStatus,
                isNonWorking: isWeekend || isFeriado
            });
        }

        return history.reverse();
    }

    calculateStats(dataToProcess: any[]) {
        this.totalEmployees = dataToProcess.length;
        this.presentToday = dataToProcess.filter(e => e.status === 'Puntual' || e.status === 'Tarde' || e.status === 'Justificado').length;
        this.lateToday = dataToProcess.filter(e => e.status === 'Tarde').length;
        this.absentToday = dataToProcess.filter(e => e.status === 'Falta').length;
    }

    filterData() {
        if (!this.searchText) {
            this.displayedData = [...this.mockAttendanceData];
        } else {
            const lowerQuery = this.searchText.toLowerCase();
            this.displayedData = this.mockAttendanceData.filter(emp =>
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