import mongoose from 'mongoose';

const prestamoSchema = new mongoose.Schema({
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado' },
    dni: { type: String },
    monto: { type: Number, required: true },
    fecha: { type: Date, default: Date.now },
    cuotas: { type: Number, default: 1 },
    observacion: { type: String },
    estado: { type: String }
}, {
    timestamps: true,
    collection: 'prestamos',
    strict: false
});

const Prestamo = mongoose.model('Prestamo', prestamoSchema);
export default Prestamo;
