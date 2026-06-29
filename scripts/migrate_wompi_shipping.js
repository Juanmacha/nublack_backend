import sequelize from '../src/config/database.js';

const columns = [
    { name: 'estado_pago', sql: "ADD COLUMN estado_pago ENUM('pendiente','pagado','fallido','expirado','no_aplica') DEFAULT 'no_aplica'" },
    { name: 'wompi_transaction_id', sql: 'ADD COLUMN wompi_transaction_id VARCHAR(100) NULL' },
    { name: 'wompi_reference', sql: 'ADD COLUMN wompi_reference VARCHAR(100) NULL' },
    { name: 'wompi_payment_method_type', sql: 'ADD COLUMN wompi_payment_method_type VARCHAR(50) NULL' },
    { name: 'fecha_pago', sql: 'ADD COLUMN fecha_pago DATETIME NULL' },
    { name: 'pago_expira_at', sql: 'ADD COLUMN pago_expira_at DATETIME NULL' },
    { name: 'numero_guia', sql: 'ADD COLUMN numero_guia VARCHAR(100) NULL' },
    { name: 'nombre_empaquetadora', sql: 'ADD COLUMN nombre_empaquetadora VARCHAR(150) NULL' },
    { name: 'fecha_despacho', sql: 'ADD COLUMN fecha_despacho DATETIME NULL' }
];

async function columnExists(table, column) {
    const [rows] = await sequelize.query(`SHOW COLUMNS FROM ${table} LIKE '${column}';`);
    return rows && rows.length > 0;
}

async function run() {
    try {
        await sequelize.authenticate();
        console.log('Conectado a la base de datos.');

        for (const col of columns) {
            const exists = await columnExists('solicitudes', col.name);
            if (!exists) {
                await sequelize.query(`ALTER TABLE solicitudes ${col.sql};`);
                console.log(`✅ Columna ${col.name} añadida.`);
            } else {
                console.log(`ℹ️ Columna ${col.name} ya existe.`);
            }
        }

        // Ampliar metodo_pago para incluir Pasarela (mantener valores legacy)
        try {
            await sequelize.query(`
                ALTER TABLE solicitudes
                MODIFY COLUMN metodo_pago
                ENUM('Contra Entrega', 'Pasarela', 'Tarjeta', 'Transferencia', 'PSE')
                DEFAULT 'Contra Entrega';
            `);
            console.log('✅ ENUM metodo_pago actualizado.');
        } catch (e) {
            console.log('⚠️ metodo_pago:', e.message);
        }

        try {
            await sequelize.query('CREATE INDEX idx_solicitudes_pago_expira ON solicitudes (pago_expira_at, estado_pago);');
            console.log('✅ Índice pago_expira_at creado.');
        } catch (e) {
            console.log('ℹ️ Índice pago_expira:', e.message);
        }

        process.exit(0);
    } catch (error) {
        console.error('Error en migración:', error.message);
        process.exit(1);
    }
}

run();
