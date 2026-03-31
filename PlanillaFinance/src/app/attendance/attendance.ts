import { Component, OnInit } from "@angular/core";
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-attendance',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './attendance.html',
    styleUrl: './attendance.css'
})
export class AttendanceComponent implements OnInit {
    viewMode: 'daily' | 'monthly' = 'daily';

    selectedDate: string = new Date().toISOString().split('T')[0];
    selectedMonth: string = new Date().toISOString().slice(0, 7); // YYYY-MM
    searchTerm: string = '';

    // Summary properties
    totalEmpleados = 0;
    presentes = 0;
    tardanzas = 0;
    ausentes = 0;
    promedioHoras = '0h 0m';

    // Summary properties para Mensual
    totalMesDias = 15; // Simulación de 15 días laborables hasta hoy
    promedioTardanzasMes = 0;
    totalFaltasMes = 0;

    // Dummy data interactiva para mostrarte cómo se vería
    dummyData = [
        { fecha: '2026-03-30', empId: 'E001', nombre: 'ANGEL RICARDO BENITES TAPIA', cargo: 'Gerente', entrada: '08:00 AM', salida: '05:45 PM', totalHoras: '8h 45m', base: '8h', extra: '45m', estado: 'Puntual' },
        { fecha: '2026-03-30', empId: 'E002', nombre: 'VALERIE SOLANGE ZARZOSA CARRASCO', cargo: 'Vendedor', entrada: '08:15 AM', salida: '06:10 PM', totalHoras: '8h 55m', base: '8h', extra: '55m', estado: 'Tarde' },
        { fecha: '2026-03-30', empId: 'E003', nombre: 'MILAGROS ESTHER QUISPE', cargo: 'Administrador', entrada: '08:04 AM', salida: '05:04 PM', totalHoras: '8h 0m', base: '8h', extra: '0h', estado: 'Puntual' },
        { fecha: '2026-03-30', empId: 'E004', nombre: 'GERALDINE BEJAR GUTIERREZ', cargo: 'Recepcionista', entrada: '-', salida: '-', totalHoras: '0h', base: '0h', extra: '0h', estado: 'Falta' },
        { fecha: '2026-03-30', empId: 'E005', nombre: 'JUAN CARLOS PEREZ', cargo: 'Operario', entrada: '08:10 AM', salida: '05:25 PM', totalHoras: '8h 15m', base: '8h', extra: '15m', falta: '0h', estado: 'Tarde' },
        { fecha: '2026-03-30', empId: 'E006', nombre: 'MARIA FERNANDA LOPEZ', cargo: 'Vendedor', entrada: '07:55 AM', salida: '06:30 PM', totalHoras: '9h 35m', base: '8h', extra: '1h 35m', falta: '0h', estado: 'Puntual' },
        { fecha: '2026-03-30', empId: 'E007', nombre: 'LUIS ALBERTO GOMEZ', cargo: 'Almacen', entrada: '08:00 AM', salida: '03:30 PM', totalHoras: '6h 30m', base: '6h 30m', extra: '0h', falta: '1h 30m', estado: 'Salida Temprana' },
        { fecha: '2026-03-30', empId: 'E008', nombre: 'ANA ROSA CASTILLO', cargo: 'Atención al Cliente', entrada: '08:25 AM', salida: '06:30 PM', totalHoras: '9h 5m', base: '8h', extra: '1h 5m', falta: '0h', estado: 'Tarde' },
        { fecha: '2026-03-30', empId: 'E009', nombre: 'PEDRO ALONSO RUIZ', cargo: 'Operario', entrada: '-', salida: '-', totalHoras: '0h', base: '0h', extra: '0h', estado: 'Falta' },
        { fecha: '2026-03-30', empId: 'E010', nombre: 'CARMEN SILVA VEGA', cargo: 'Contabilidad', entrada: '08:02 AM', salida: '05:15 PM', totalHoras: '8h 13m', base: '8h', extra: '13m', estado: 'Puntual' },
    ];

    // Dummy data interactiva Mensual (Consolidado de 15 días del mes)
    monthlySummaryData = [
        { empId: 'E001', nombre: 'ANGEL RICARDO BENITES TAPIA', cargo: 'Gerente', diasAsistidos: 15, faltas: 0, tardanzasTotales: 2, minTardeTotales: 15, horasExtraTotal: '1h 05m', horasFaltaTotal: '0h', estado: 'Excelente', extraAprobada: false },
        { empId: 'E002', nombre: 'VALERIE SOLANGE ZARZOSA CARRASCO', cargo: 'Vendedor', diasAsistidos: 14, faltas: 1, tardanzasTotales: 5, minTardeTotales: 125, horasExtraTotal: '5h 15m', horasFaltaTotal: '8h 0m', estado: 'Regular', extraAprobada: false },
        { empId: 'E003', nombre: 'MILAGROS ESTHER QUISPE', cargo: 'Administrador', diasAsistidos: 15, faltas: 0, tardanzasTotales: 0, minTardeTotales: 0, horasExtraTotal: '2h 0m', horasFaltaTotal: '0h', estado: 'Excelente', extraAprobada: true },
        { empId: 'E004', nombre: 'GERALDINE BEJAR GUTIERREZ', cargo: 'Recepcionista', diasAsistidos: 12, faltas: 3, tardanzasTotales: 8, minTardeTotales: 210, horasExtraTotal: '0h', horasFaltaTotal: '24h 0m', estado: 'Observado', extraAprobada: false },
        { empId: 'E005', nombre: 'JUAN CARLOS PEREZ', cargo: 'Operario', diasAsistidos: 15, faltas: 0, tardanzasTotales: 3, minTardeTotales: 45, horasExtraTotal: '6h 45m', horasFaltaTotal: '0h', estado: 'Regular', extraAprobada: false },
        { empId: 'E006', nombre: 'MARIA FERNANDA LOPEZ', cargo: 'Vendedor', diasAsistidos: 15, faltas: 0, tardanzasTotales: 1, minTardeTotales: 10, horasExtraTotal: '15h 20m', horasFaltaTotal: '0h', estado: 'Excelente', extraAprobada: false },
        { empId: 'E007', nombre: 'LUIS ALBERTO GOMEZ', cargo: 'Almacen', diasAsistidos: 13, faltas: 2, tardanzasTotales: 0, minTardeTotales: 0, horasExtraTotal: '1h 0m', horasFaltaTotal: '17h 30m', estado: 'Observado', extraAprobada: false },
        { empId: 'E008', nombre: 'ANA ROSA CASTILLO', cargo: 'Atención al Cliente', diasAsistidos: 15, faltas: 0, tardanzasTotales: 6, minTardeTotales: 95, horasExtraTotal: '8h 10m', horasFaltaTotal: '0h', estado: 'Regular', extraAprobada: false },
        { empId: 'E009', nombre: 'PEDRO ALONSO RUIZ', cargo: 'Operario', diasAsistidos: 11, faltas: 4, tardanzasTotales: 2, minTardeTotales: 20, horasExtraTotal: '0h', horasFaltaTotal: '32h 0m', estado: 'Crítico', extraAprobada: false },
        { empId: 'E010', nombre: 'CARMEN SILVA VEGA', cargo: 'Contabilidad', diasAsistidos: 15, faltas: 0, tardanzasTotales: 1, minTardeTotales: 12, horasExtraTotal: '4h 15m', horasFaltaTotal: '0h', estado: 'Excelente', extraAprobada: false },
    ];

    filteredData: any[] = [];
    filteredMonthlyData: any[] = [];

    // Modal properties
    isModalOpen = false;
    selectedEmployeeName = '';
    employeeHistory: any[] = [];

    ngOnInit() {
        this.calcularResumen();
    }

    setViewMode(mode: 'daily' | 'monthly') {
        this.viewMode = mode;
    }

    calcularResumen() {
        // Daily Calculations
        this.totalEmpleados = this.dummyData.length;
        this.presentes = this.dummyData.filter(d => d.estado !== 'Falta').length;
        this.tardanzas = this.dummyData.filter(d => d.estado === 'Tarde').length;
        this.ausentes = this.dummyData.filter(d => d.estado === 'Falta').length;
        this.promedioHoras = '8Hrs';
        this.filteredData = [...this.dummyData];

        // Monthly Calculations
        this.totalFaltasMes = this.monthlySummaryData.reduce((acc: number, curr: any) => acc + curr.faltas, 0);
        this.promedioTardanzasMes = Math.floor(this.monthlySummaryData.reduce((acc: number, curr: any) => acc + curr.tardanzasTotales, 0) / this.monthlySummaryData.length);
        this.filteredMonthlyData = [...this.monthlySummaryData];
    }

    openDetailsModal(empleado: any) {
        this.selectedEmployeeName = empleado.nombre;
        this.employeeHistory = [];

        // Simular historial de los últimos 15 días laborables
        let baseDate = new Date(2026, 2, 2); // Empezamos en Lunes 2 de Marzo
        for (let i = 0; i < 21; i++) { // Extendido a 21 iteraciones para abarcar los fines de semana
            let currentDate = new Date(baseDate);
            currentDate.setDate(baseDate.getDate() + i);

            // Saltar Sábados y Domingos
            if (currentDate.getDay() === 0 || currentDate.getDay() === 6) continue;

            // Valores Base Normales
            let entrada = '08:00 AM';
            let salida = '05:00 PM';
            let estado = 'Puntual';
            let extra = '0h';
            let falta = '0h';

            // Simular los ejemplos específicos que pidió el usuario
            if (i === 0) {
                // Lunes 2 Marzo "llega 7:55 y sale a las 5:40"
                entrada = '07:55 AM'; salida = '05:40 PM'; estado = 'Puntual'; extra = '45m';
            }
            if (i === 1) {
                // Martes 3 Marzo "llega a las 8:10 y sale 5:30"
                entrada = '08:10 AM'; salida = '05:30 PM'; estado = 'Tarde'; extra = '20m';
            }
            if (i === 4) {
                // Viernes 6 Marzo - Salió muy temprano
                entrada = '08:00 AM'; salida = '03:30 PM'; estado = 'Salida Temprana'; falta = '1h 30m';
            }
            if (i === 9) {
                // Miércoles 11 Marzo - No fue a trabajar
                entrada = '-'; salida = '-'; estado = 'Falta'; falta = '8h 0m';
            }

            this.employeeHistory.push({
                fecha: currentDate.toISOString().split('T')[0],
                entrada: entrada,
                salida: salida,
                extra: extra,
                falta: falta,
                estado: estado
            });
        }

        this.isModalOpen = true;
    }

    closeModal() {
        this.isModalOpen = false;
    }
}