import mongoose from 'mongoose';

const historialPagoSchema = new mongoose.Schema({
    periodo: { type: String, required: true },
    mes: { type: String, required: true },
    año: { type: Number, required: true },
    estado: { type: String, default: 'GUARDADA' },
    empleados: [{
        empleadoId: String,
        nombre: String,
        apellidos: String,
        cargo: String,
        tipoTrabajador: String,
        sueldo: { type: Number, default: 0 },
        bonos: { type: Number, default: 0 },
        bonosDetalle: [{
            motivo: String,
            fecha: Date,
            monto: Number,
            permanente: { type: Boolean, default: false }
        }],
        horasExtras: { type: Number, default: 0 },
        montoHorasExtras: { type: Number, default: 0 },
        regimenPensionario: String,
        descuentoAfp: { type: Number, default: 0 },
        adelanto: { type: Number, default: 0 },
        prestamo: { type: Number, default: 0 },
        faltasDias: { type: Number, default: 0 },
        faltasHoras: { type: Number, default: 0 },
        montoFaltas: { type: Number, default: 0 },
        descuentoAdicional: { type: Number, default: 0 },
        totalDescuento: { type: Number, default: 0 },
        remuneracionNeta: { type: Number, default: 0 },
        observaciones: String
    }]
}, {
    timestamps: true
});

historialPagoSchema.index({ periodo: 1 }, { unique: true });

const HistorialPago = mongoose.model('HistorialPago', historialPagoSchema, 'historial_pagos');

export default HistorialPago;
