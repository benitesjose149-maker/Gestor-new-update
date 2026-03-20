import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { API_URL, getAuthHeaders } from '../api-config';

@Component({
    selector: 'app-dashboard',
    standalone: true,
    imports: [CommonModule, RouterLink],
    templateUrl: './dashboard.html',
    styleUrl: './dashboard.css'
})
export class DashboardComponent implements OnInit {
    stats: any[] = [];
    birthdays: any[] = [];
    contractExpirations: any[] = [];

    async ngOnInit() {
        await this.loadStats();
    }

    async loadStats() {
        try {
            const response = await fetch(`${API_URL}/api/dashboard/stats`, {
                headers: getAuthHeaders()
            });
            const data = await response.json();
            this.stats = data.stats || [];
            this.birthdays = data.birthdays || [];
            this.contractExpirations = data.contractExpirations || [];
        } catch (error) {
            console.error('Error loading dashboard stats:', error);
            this.stats = [
                { title: 'Error', value: '---', change: 'Error de conexión', icon: '❌', color: 'red' }
            ];
        }
    }
}
