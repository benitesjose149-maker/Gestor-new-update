
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private currentUserSubject: BehaviorSubject<any>;
  public currentUser: Observable<any>;

  constructor(private router: Router) {
    const savedUser = localStorage.getItem('currentUser');
    this.currentUserSubject = new BehaviorSubject<any>(savedUser ? JSON.parse(savedUser) : null);
    this.currentUser = this.currentUserSubject.asObservable();
  }

  public get currentUserValue(): any {
    return this.currentUserSubject.value;
  }

  isLoggedIn(): boolean {
    return !!this.currentUserValue;
  }

  login(user: any) {
    localStorage.setItem('currentUser', JSON.stringify(user));
    this.currentUserSubject.next(user);
  }

  logout() {
    localStorage.removeItem('currentUser');
    // We could also clear remembered credentials if we want a complete reset,
    // but usually "Remember Me" is persistent. However, the user said
    // "al presionar en retroceder de mi navegador desde el login me regresa a mi pagina anterior"
    // which implies they want to be sure they are logged out.
    this.currentUserSubject.next(null);
    this.router.navigate(['/login']);
  }
}
