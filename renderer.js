const { ipcRenderer } = require('electron');

// Navigation
function navigateTo(page) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    
    // Remove active class from all nav links
    document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
    
    // Show selected page
    const selectedPage = document.querySelector(`#${page}`);
    if (selectedPage) {
        selectedPage.classList.remove('hidden');
    }
    
    // Set active nav link
    const navLink = document.querySelector(`.nav-link[onclick*="'${page}')"]`);
    if (navLink) {
        navLink.classList.add('active');
    }
    
    // Load data for specific pages
    if (page === 'reserve') loadReservations();
    if (page === 'pending') loadPendingPayments();
    if (page === 'records') loadVehicleRecords();
}

// Initialize Bootstrap modal
const returnModal = new bootstrap.Modal(document.getElementById('returnModal'));

// Reservation Form Handler
document.getElementById('reservationForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = {
        vehicleNumber: document.getElementById('vehicleNumber').value,
        company: document.getElementById('company').value,
        startDate: document.getElementById('startDate').value,
        endDate: document.getElementById('endDate').value,
        pricePerHour: parseFloat(document.getElementById('pricePerHour').value),
        vehicleType: document.querySelector('input[name="vehicleType"]:checked').value
    };

    try {
        await ipcRenderer.invoke('add-reservation', formData);
        document.getElementById('reservationForm').reset();
        loadReservations();
    } catch (error) {
        alert('Error adding reservation: ' + error.message);
    }
});

// Load Reservations
async function loadReservations() {
    try {
        const reservations = await ipcRenderer.invoke('get-reservations');
        const tbody = document.getElementById('reservationsTable');
        tbody.innerHTML = '';
        
        reservations.forEach(reservation => {
            const row = document.createElement('tr');
            row.dataset.pricePerHour = reservation.price_per_hour;
            row.innerHTML = `
                <td>${reservation.vehicle_number || '-'}</td>
                <td>${reservation.company || '-'}</td>
                <td>${reservation.start_date ? new Date(reservation.start_date).toLocaleString() : '-'}</td>
                <td>${reservation.end_date ? new Date(reservation.end_date).toLocaleString() : '-'}</td>
                <td>${reservation.vehicle_type || '-'}</td>
                <td>${typeof reservation.price_per_hour === 'number' ? reservation.price_per_hour.toFixed(2) : '0.00'}</td>
                <td>
                    <button class="btn btn-warning btn-sm me-1" onclick="showReturnModal(${reservation.id}, '${reservation.vehicle_number}', '${reservation.company}', '${reservation.start_date}', '${reservation.end_date}')">
                        Return
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="deleteReservation(${reservation.id})">
                        Delete
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (error) {
        alert('Error loading reservations: ' + error.message);
    }
}

// Show Return Modal
function showReturnModal(id, vehicleNumber, company, startDate, endDate) {
    const reservation = document.querySelector(`#reservationsTable tr button[onclick*="${id}"]`).closest('tr');
    document.getElementById('returnReservationId').value = id;
    // Remove price per hour from return modal since it's in the main form
    document.getElementById('pricePerHour').value = reservation.dataset.pricePerHour;
    returnModal.show();
}

// Return Vehicle Handler
async function returnVehicle() {
    const reservationId = document.getElementById('returnReservationId').value;
    const totalHours = parseFloat(document.getElementById('totalHours').value);
    const pricePerHour = parseFloat(document.getElementById('pricePerHour').value);
    const vehicleExpenses = parseFloat(document.getElementById('vehicleExpenses').value);
    const expectedPaymentDate = document.getElementById('expectedPaymentDate').value;

    const totalPrice = totalHours * pricePerHour;
    const totalPriceVat = totalPrice * 1.05; // Adding 5% VAT

    const reservation = (await ipcRenderer.invoke('get-reservations'))
        .find(r => r.id === parseInt(reservationId));

    const data = {
        reservationId,
        vehicleNumber: reservation.vehicle_number,
        company: reservation.company,
        startDate: reservation.start_date,
        endDate: reservation.end_date,
        totalHours,
        pricePerHour,
        totalPrice,
        totalPriceVat,
        vehicleExpenses,
        expectedPaymentDate
    };

    try {
        await ipcRenderer.invoke('move-to-pending', data);
        returnModal.hide();
        document.getElementById('returnForm').reset();
        loadReservations();
    } catch (error) {
        alert('Error returning vehicle: ' + error.message);
    }
}

// Load Pending Payments
async function loadPendingPayments() {
    try {
        const payments = await ipcRenderer.invoke('get-pending-payments');
        const tbody = document.getElementById('pendingPaymentsTable');
        tbody.innerHTML = '';
        
        payments.forEach(payment => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${payment.vehicle_number || '-'}</td>
                <td>${payment.company || '-'}</td>
                <td>${payment.start_date ? new Date(payment.start_date).toLocaleString() : '-'}</td>
                <td>${payment.end_date ? new Date(payment.end_date).toLocaleString() : '-'}</td>
                <td>${typeof payment.total_hours === 'number' ? payment.total_hours : '0'}</td>
                <td>${typeof payment.price_per_hour === 'number' ? payment.price_per_hour.toFixed(2) : '0.00'}</td>
                <td>${typeof payment.total_price === 'number' ? payment.total_price.toFixed(2) : '0.00'}</td>
                <td>${typeof payment.total_price_vat === 'number' ? payment.total_price_vat.toFixed(2) : '0.00'}</td>
                <td>${typeof payment.vehicle_expenses === 'number' ? payment.vehicle_expenses.toFixed(2) : '0.00'}</td>
                <td>${payment.expected_payment_date ? new Date(payment.expected_payment_date).toLocaleDateString() : '-'}</td>
                <td>
                    <button class="btn btn-success btn-sm me-1" onclick="clearPayment(${payment.id})">
                        Clear Payment
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="deletePendingPayment(${payment.id})">
                        Delete
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (error) {
        alert('Error loading pending payments: ' + error.message);
    }
}

// Clear Payment Handler
async function clearPayment(id) {
    try {
        const payments = await ipcRenderer.invoke('get-pending-payments');
        const payment = payments.find(p => p.id === id);
        
        if (!payment) {
            throw new Error('Payment record not found');
        }

        const paymentData = {
            id: payment.id,
            vehicleNumber: payment.vehicle_number,
            company: payment.company,
            startDate: payment.start_date,
            endDate: payment.end_date,
            totalPrice: payment.total_price || 0,
            totalPriceVat: payment.total_price_vat || 0,
            vehicleExpenses: payment.vehicle_expenses || 0
        };

        await ipcRenderer.invoke('clear-payment', paymentData);
        await loadPendingPayments();
        await loadVehicleRecords(); // Refresh the records table
    } catch (error) {
        console.error('Clear payment error:', error);
        alert('Error clearing payment: ' + error.message);
    }
}

// Load Vehicle Records
async function loadVehicleRecords() {
    try {
        const records = await ipcRenderer.invoke('get-vehicle-records');
        const tbody = document.getElementById('vehicleRecordsTable');
        tbody.innerHTML = '';
        
        records.forEach(record => {
            const row = document.createElement('tr');
            const totalPriceVat = typeof record.total_price_vat === 'number' ? record.total_price_vat : 0;
            const vehicleExpenses = typeof record.vehicle_expenses === 'number' ? record.vehicle_expenses : 0;
            const profit = totalPriceVat - vehicleExpenses;
            
            row.innerHTML = `
                <td>${record.vehicle_number || '-'}</td>
                <td>${record.company || '-'}</td>
                <td>${record.start_date ? new Date(record.start_date).toLocaleString() : '-'}</td>
                <td>${record.end_date ? new Date(record.end_date).toLocaleString() : '-'}</td>
                <td>${typeof record.total_price === 'number' ? record.total_price.toFixed(2) : '0.00'}</td>
                <td>${totalPriceVat.toFixed(2)}</td>
                <td>${vehicleExpenses.toFixed(2)}</td>
                <td>${profit.toFixed(2)}</td>
                <td>${record.payment_date ? new Date(record.payment_date).toLocaleString() : '-'}</td>
            `;
            tbody.appendChild(row);
        });
    } catch (error) {
        alert('Error loading vehicle records: ' + error.message);
    }
}

// Delete Reservation Handler
async function deleteReservation(id) {
    if (confirm('Are you sure you want to delete this reservation?')) {
        try {
            await ipcRenderer.invoke('delete-reservation', id);
            loadReservations();
        } catch (error) {
            console.error('Delete reservation error:', error);
            alert('Error deleting reservation: ' + error.message);
        }
    }
}

// Delete Pending Payment Handler
async function deletePendingPayment(id) {
    if (confirm('Are you sure you want to delete this pending payment?')) {
        try {
            await ipcRenderer.invoke('delete-pending-payment', id);
            loadPendingPayments();
        } catch (error) {
            console.error('Delete pending payment error:', error);
            alert('Error deleting pending payment: ' + error.message);
        }
    }
}

// Initial page load
navigateTo('home');
