import mongoose from 'mongoose';

const connectDB = async () => {
    try {
        // URI provided by user
        const conn = await mongoose.connect('mongodb://admin:Lokito_239591@15.235.16.229:27017/planilla?authSource=admin&tls=false');
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
};

export default connectDB;
