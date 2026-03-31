import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { NotificationService } from '../shared/notification.service';
import { API_URL } from '../api-config';
@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private currentUserSubject: BehaviorSubject<any>;
  public currentUser: Observable<any>;
  private autoRefreshStarted = false;
  constructor(
    private router: Router,
    private notificationService: NotificationService,
    private http: HttpClient
  ) {
    const savedUser = sessionStorage.getItem('currentUser');
    this.currentUserSubject = new BehaviorSubject<any>(savedUser ? JSON.parse(savedUser) : null);
    this.currentUser = this.currentUserSubject.asObservable();
    if (savedUser) {
      this.startAutoRefresh();
    }
  }
  public get currentUserValue(): any {
    return this.currentUserSubject.value;
  }
  isLoggedIn(): boolean {
    return !!this.currentUserValue;
  }
  login(user: any) {
    sessionStorage.setItem('currentUser', JSON.stringify(user));
    this.currentUserSubject.next(user);
    this.startAutoRefresh();
  }
  logout() {
    sessionStorage.removeItem('currentUser');
    this.currentUserSubject.next(null);
    this.router.navigate(['/login']);
  }
  async refreshPermissions() {
    const user = this.currentUserValue;
    if (!user || !user.email) return;
    try {
      const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3005' : '';
      const url = `${API_URL}/api/auth/me/${user.email}`;
      const data: any = await firstValueFrom(this.http.get(url));
      if (data && data.success && data.user) {
        const newPerms = data.user.permissions;
        const oldPerms = user.permissions;
        if (JSON.stringify(newPerms) !== JSON.stringify(oldPerms)) {
          console.log('Permisos actualizados detectados.');
          const updatedUser = {
            ...user,
            permissions: newPerms,
            rol: data.user.rol,
            fullName: data.user.fullName
          };
          sessionStorage.setItem('currentUser', JSON.stringify(updatedUser));
          this.currentUserSubject.next(updatedUser);
          this.notificationService.info('Se han actualizado sus permisos de acceso.', 5000);
        }
      }
    } catch (error) {
      console.error('Error al sincronizar permisos:', error);
    }
  }
  private startAutoRefresh() {
    if (this.autoRefreshStarted) return;
    this.autoRefreshStarted = true;
    this.refreshPermissions();
    setInterval(() => {
      this.refreshPermissions();
    }, 300000);
  }
}