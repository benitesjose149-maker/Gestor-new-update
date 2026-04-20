import { Routes } from '@angular/router';
import { LoginComponent } from './login/login';
import { DashboardComponent } from './dashboard/dashboard';
import { GestionEmpleadosComponent } from './employees/employees';
import { ArchivedEmployeesComponent } from './archived-employees/archived-employees';
import { LayoutComponent } from './layout/layout';

import { PlanillaComponent } from './planilla/planilla';
import { MovimientosComponent } from './Movements/movements';

import { HistorialPagoComponent } from './historial-pago/historial-pago';
import { FinanceDashboardComponent } from './finance-dashboard/finance-dashboard';
import { SettingsPermissionsComponent } from './settings/settings-permissions';
import { authGuard } from './auth/auth.guard';
import { VacationsComponent } from './vacations/vacations';
import { AttendanceComponent } from './attendance/attendance';
import { WhmcsHistoryComponent } from './whmcs-history/whmcs-history';
export const routes: Routes = [
    { path: 'login', component: LoginComponent },
    {
        path: '',
        component: LayoutComponent,
        canActivate: [authGuard],
        children: [
            { path: 'dashboard', component: DashboardComponent },
            { path: 'employees', component: GestionEmpleadosComponent },
            { path: 'archived-employees', component: ArchivedEmployeesComponent },
            { path: 'planilla', component: PlanillaComponent },
            { path: 'movements', component: MovimientosComponent },
            { path: 'historial-pago', component: HistorialPagoComponent },
            { path: 'finance', component: FinanceDashboardComponent },
            { path: 'whmcs-history', component: WhmcsHistoryComponent },
            { path: 'vacations', component: VacationsComponent },
            { path: 'settings', component: SettingsPermissionsComponent },
            { path: '', redirectTo: '/login', pathMatch: 'full' },
            { path: 'attendance', component: AttendanceComponent },
        ]
    }
];
