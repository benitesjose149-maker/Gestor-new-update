import mongoose from 'mongoose';

const adelantoSchema = new mongoose.Schema({
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado' },
    dni: { type: String },
    monto: { type: Number },
    fechaSolicitud: { type: Date },
    fechaAprobacion: { type: Date },
    observaciones: { type: String },
    estado: { type: String },
    tipo: { type: String }
}, {
    timestamps: true,
    collection: 'adelantos',
    strict: false // Allow other fields
});

const Adelanto = mongoose.model('Adelanto', adelantoSchema);
export default Adelanto;
