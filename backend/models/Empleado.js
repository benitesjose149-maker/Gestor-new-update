import mongoose from 'mongoose';

const executeSchema = new mongoose.Schema({
    nombre: { type: String, required: true },
    apellidos: { type: String, required: true },
    dni: { type: String, required: true, unique: true },
    sexo: { type: String },
    nacionalidad: { type: String },
    telefono: { type: String },
    contactoEmergencia: { type: String },
    numeroEmergencia: { type: String },
    fechaNacimiento: { type: Date },
    direccion: { type: String },

    email: { type: String },
    cargo: { type: String, required: true },
    departamento: { type: String, required: true },
    tipoTrabajador: { type: String, default: 'PLANILLA' },
    regimenPensionario: { type: String, default: 'SNP' },
    sueldo: { type: Number, default: 0 },
    asignacionFamiliar: { type: Boolean, default: false },
    calculoAfpMinimo: { type: Boolean, default: false },

    fechaInicio: { type: Date, default: Date.now },
    fechaFinContrato: { type: Date },
    tipoContrato: { type: String },
    horarioTrabajo: { type: String },

    banco: { type: String },
    tipoCuenta: { type: String },
    numeroCuenta: { type: String },
    cci: { type: String },

    nivelEducativo: { type: String },

    // Payroll Fields
    bonos: { type: Number, default: 0 },
    bonosDetalle: [{
        motivo: { type: String },
        fecha: { type: Date },
        monto: { type: Number },
        permanente: { type: Boolean, default: false }
    }],
    horasExtras: { type: Number, default: 0 },
    faltasDias: { type: Number, default: 0 },
    faltasHoras: { type: Number, default: 0 },
    adelanto: { type: Number, default: 0 },
    prestamo: { type: Number, default: 0 },
    descuentoAdicional: { type: Number, default: 0 }, // Total sum
    // New field for detailed Salary Movements
    movimientos: [{
        tipo: { type: String, enum: ['ADELANTO', 'PRESTAMO', 'VIATICOS', 'MOVILIDAD', 'OTROS'] },
        fecha: { type: Date, default: Date.now },
        monto: { type: Number, required: true },
        cuotas: { type: Number, default: 1 }, // 1 for simple, >1 for installments
        observacion: { type: String }
    }],
    descuentosAdicionales: [{
        motivo: { type: String },
        fecha: { type: Date },
        monto: { type: Number }
    }],
    observaciones: { type: String, default: '' },

    estado: { type: String, default: 'Activo' }
}, {
    timestamps: true
});

const Empleado = mongoose.model('Empleado', executeSchema);

export default Empleado;
