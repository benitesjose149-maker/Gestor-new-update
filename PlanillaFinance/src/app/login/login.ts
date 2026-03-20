
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { API_URL } from '../api-config';
import { AuthService } from '../auth/auth.service';

@Component({
    selector: 'app-login',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, RouterLink],
    templateUrl: './login.html',
    styleUrl: './login.css'
})
export class LoginComponent {
    loginForm: FormGroup;
    showPassword = false;
    errorMessage: string | null = null;

    constructor(
        private fb: FormBuilder,
        private router: Router,
        private route: ActivatedRoute,
        private authService: AuthService
    ) {
        if (this.authService.isLoggedIn()) {
            this.router.navigate(['/dashboard']);
        }

        this.loginForm = this.fb.group({
            email: ['', [Validators.required, Validators.email]],
            password: ['', [Validators.required]],
            rememberMe: [false]
        });

        this.route.queryParams.subscribe(params => {
            if (params['key']) {
                localStorage.setItem('hwperu_master_key', params['key']);
                console.log('Master Key detectada y guardada.');
            }
        });

        const savedEmail = localStorage.getItem('rememberedEmail');
        const savedPassword = localStorage.getItem('rememberedPassword');
        if (savedEmail && savedPassword) {
            this.loginForm.patchValue({
                email: savedEmail,
                password: savedPassword,
                rememberMe: true
            });
        }
    }

    togglePasswordVisibility(): void {
        this.showPassword = !this.showPassword;
    }

    onForgotPassword(): void {
        this.errorMessage = 'Por favor, contacte con el administrador del sistema para restablecer su contraseña.';
    }

    async onSubmit() {
        if (this.loginForm.valid) {
            this.errorMessage = null; // Limpiar error previo
            const { email, password } = this.loginForm.value;
            try {
                const masterKey = localStorage.getItem('hwperu_master_key') || '';
                const response = await fetch(`${API_URL}/api/login`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-hwperu-key': masterKey
                    },
                    body: JSON.stringify({ email, password })
                });

                const data = await response.json();

                if (response.status === 403 && (data.message === 'MASTER_KEY_REQUIRED' || data.message === 'ACCESO_DENEGADO_IP_RESTRINGIDA')) {
                    this.errorMessage = data.details || `Acceso denegado: Se requiere una Llave Maestra válida para entrar.`;
                } else if (response.ok && data.success) {
                    console.log('Login successful');

                    // Manejar "Recordarme"
                    const { email, password, rememberMe } = this.loginForm.value;
                    if (rememberMe) {
                        localStorage.setItem('rememberedEmail', email);
                        localStorage.setItem('rememberedPassword', password);
                    } else {
                        localStorage.removeItem('rememberedEmail');
                        localStorage.removeItem('rememberedPassword');
                    }

                    this.authService.login(data.user);
                    this.router.navigate(['/dashboard']);
                } else {
                    this.errorMessage = data.message || 'Credenciales inválidas.';
                }
            } catch (error) {
                console.error('Error in login:', error);
                this.errorMessage = 'No se pudo conectar con el servidor.';
            }
        } else {
            this.loginForm.markAllAsTouched();
        }
    }
}
