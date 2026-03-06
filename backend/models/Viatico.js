import mongoose from 'mongoose';

const viaticoSchema = new mongoose.Schema({
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado' },
    dni: { type: String },
    monto: { type: Number, required: true },
    fecha: { type: Date, default: Date.now },
    concepto: { type: String },
    observacion: { type: String }
}, {
    timestamps: true,
    collection: 'tb_Viaticos',
    strict: false
});

const Viatico = mongoose.model('Viatico', viaticoSchema);
export default Viatico;
