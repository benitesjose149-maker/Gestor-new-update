import mongoose from 'mongoose';

const movilidadSchema = new mongoose.Schema({
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado' },
    dni: { type: String },
    monto: { type: Number, required: true },
    fecha: { type: Date, default: Date.now },
    observacion: { type: String },
    detalle: { type: String }
}, {
    timestamps: true,
    collection: 'tb_Movilidad',
    strict: false
});

const Movilidad = mongoose.model('Movilidad', movilidadSchema);
export default Movilidad;
