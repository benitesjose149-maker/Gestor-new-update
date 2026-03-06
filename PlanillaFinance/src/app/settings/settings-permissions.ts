import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { API_URL } from '../api-config';

@Component({
    selector: 'app-settings-permissions',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './settings-permissions.html',
    styleUrl: './settings-permissions.css'
})
export class SettingsPermissionsComponent implements OnInit {
    users: any[] = [];
    blockedAccounts: any[] = [];
    loading = true;
    creatingUser = false;

    // Formulario de nuevo usuario
    newUser = {
        email: '',
        password: '',
        full_name: '',
        role: 'ADMIN',
        permissions: {
            planilla: false,
            movimientos: false,
            finanzas: false,
            empleados: false,
            archivados: false
        }
    };

    async ngOnInit() {
        await Promise.all([
            this.loadUsers(),
            this.loadBlockedAccounts()
        ]);
    }

    async loadUsers() {
        try {
            const response = await fetch(`${API_URL}/api/admin/users`);
            this.users = await response.json();
        } catch (error) {
            console.error('Error loading users:', error);
        } finally {
            this.loading = false;
        }
    }

    async loadBlockedAccounts() {
        try {
            const response = await fetch(`${API_URL}/api/admin/security/blocked`);
            this.blockedAccounts = await response.json();
        } catch (error) {
            console.error('Error loading blocked accounts:', error);
        }
    }

    async unblockAccount(account: any) {
        if (!confirm(`¿Está seguro de desbloquear el acceso para ${account.EMAIL}?`)) return;

        try {
            const response = await fetch(`${API_URL}/api/admin/security/unblock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: account.EMAIL, ip: account.IP_ADDRESS })
            });

            if (response.ok) {
                alert('Usuario desbloqueado con éxito.');
                await this.loadBlockedAccounts();
            } else {
                throw new Error('Failed to unblock');
            }
        } catch (error) {
            console.error('Error unblocking:', error);
            alert('No se pudo desbloquear al usuario.');
        }
    }

    async updateName(user: any, newName: string) {
        const originalName = user.FULL_NAME;
        user.FULL_NAME = newName;

        try {
            const response = await fetch(`${API_URL}/api/admin/update-permissions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: user.ID_USERS,
                    full_name: user.FULL_NAME,
                    can_planilla: !!user.CAN_PLANILLA,
                    can_movimientos: !!user.CAN_MOVIMIENTOS,
                    can_finanzas: !!user.CAN_FINANZAS,
                    can_empleados: !!user.CAN_EMPLEADOS,
                    can_archivados: !!user.CAN_ARCHIVADOS
                })
            });

            if (response.ok) {
                // Si es el usuario actual, actualizamos su nombre en localStorage para que el header cambie
                const currentUserJson = localStorage.getItem('currentUser');
                if (currentUserJson) {
                    const currentUser = JSON.parse(currentUserJson);
                    if (currentUser.email === user.EMAIL) {
                        currentUser.fullName = user.FULL_NAME;
                        localStorage.setItem('currentUser', JSON.stringify(currentUser));
                    }
                }
            } else {
                throw new Error('Failed to update name');
            }
        } catch (error) {
            console.error('Error updating name:', error);
            user.FULL_NAME = originalName;
            alert('No se pudo actualizar el nombre.');
        }
    }

    async togglePermission(user: any, permissionField: string) {
        // Handle both boolean and bit (1/0) types
        const currentValue = !!user[permissionField];
        const originalValue = user[permissionField];

        // Toggle value (if it was 1/0, keep it as 1/0; if true/false, keep as true/false)
        if (typeof originalValue === 'number') {
            user[permissionField] = currentValue ? 0 : 1;
        } else {
            user[permissionField] = !currentValue;
        }

        try {
            const response = await fetch(`${API_URL}/api/admin/update-permissions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: user.ID_USERS,
                    full_name: user.FULL_NAME,
                    can_planilla: !!user.CAN_PLANILLA,
                    can_movimientos: !!user.CAN_MOVIMIENTOS,
                    can_finanzas: !!user.CAN_FINANZAS,
                    can_empleados: !!user.CAN_EMPLEADOS,
                    can_archivados: !!user.CAN_ARCHIVADOS
                })
            });

            if (!response.ok) throw new Error('Failed to update');
        } catch (error) {
            console.error('Error updating permission:', error);
            // Rollback on error
            user[permissionField] = originalValue;
            alert('No se pudo actualizar el permiso.');
        }
    }

    // Métodos para creación de usuario
    generatePassword() {
        const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()";
        let pass = "";
        for (let i = 0; i < 12; i++) {
            pass += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        this.newUser.password = pass;
    }

    async createUser() {
        if (!this.newUser.email || !this.newUser.password || !this.newUser.full_name) {
            alert('Por favor, complete todos los campos obligatorios.');
            return;
        }

        this.creatingUser = true;
        try {
            const response = await fetch(`${API_URL}/api/admin/create-user`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.newUser)
            });

            const data = await response.json();

            if (response.ok && data.success) {
                alert('Usuario creado con éxito.');
                this.resetNewUser();
                await this.loadUsers();
            } else {
                alert(data.message || 'Error al crear el usuario.');
            }
        } catch (error) {
            console.error('Error creating user:', error);
            alert('Error de conexión con el servidor.');
        } finally {
            this.creatingUser = false;
        }
    }

    resetNewUser() {
        this.newUser = {
            email: '',
            password: '',
            full_name: '',
            role: 'ADMIN',
            permissions: {
                planilla: false,
                movimientos: false,
                finanzas: false,
                empleados: false,
                archivados: false
            }
        };
    }
}
