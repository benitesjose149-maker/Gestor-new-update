import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationService } from './notification.service';

@Component({
  selector: 'app-notification',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- TOAST CONTAINER -->
    <div class="toast-container">
      @for (toast of notificationService.toasts(); track toast.id) {
        <div class="toast" [class]="toast.type" (click)="notificationService.removeToast(toast.id)">
          <div class="toast-icon">
            @if (toast.type === 'success') {
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            } @else if (toast.type === 'error') {
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            } @else if (toast.type === 'warning') {
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
            } @else {
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
            }
          </div>
          <div class="toast-message">{{ toast.message }}</div>
          <button class="toast-close">&times;</button>
        </div>
      }
    </div>

    <!-- CONFIRM MODAL -->
    @if (notificationService.confirmData(); as config) {
      <div class="modal-backdrop">
        <div class="modal-container">
          <div class="modal-content">
            <div class="modal-header">
              <h3>{{ config.title }}</h3>
            </div>
            <div class="modal-body">
              <p>{{ config.message }}</p>
            </div>
            <div class="modal-actions">
              <button class="btn-cancel" (click)="config.resolve(false)">{{ config.cancelText || 'Cancelar' }}</button>
              <button class="btn-confirm" (click)="config.resolve(true)">{{ config.confirmText || 'Confirmar' }}</button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styleUrls: ['./notification.component.css']
})
export class NotificationComponent {
  notificationService = inject(NotificationService);
}
