/**
 * Diagnóstico Wompi — usa el mismo wompiService que producción.
 * Uso: npm run diagnose:wompi
 */
import dotenv from 'dotenv';
dotenv.config();

const { wompiConfig } = await import('../../src/config/wompi.js');
const {
    buildIntegrityPayload,
    generateIntegritySignature,
    probeWebCheckout,
    verifyIntegrityWithWompiTransaction,
    amountToCents
} = await import('../../src/services/wompiService.js');

async function run() {
    console.log('=== Diagnóstico Wompi (mismo servicio que API) ===\n');

    const publicKey = wompiConfig.publicKey;
    const integritySecret = wompiConfig.integritySecret;

    console.log('Config:', {
        env: wompiConfig.env,
        publicKeyPrefix: publicKey.slice(0, 12) + '...',
        integritySecretLength: integritySecret.length,
        integritySecretPrefix: integritySecret.slice(0, 16) + '...',
        redirectConfigured: wompiConfig.configuredRedirectUrl,
        redirectEffective: wompiConfig.redirectUrl
    });

    const merchantUrl = `https://sandbox.wompi.co/v1/merchants/${encodeURIComponent(publicKey)}`;
    console.log('\n1) Merchant API...');
    const mRes = await fetch(merchantUrl);
    const mBody = await mRes.json().catch(() => ({}));
    console.log('   Status:', mRes.status, mRes.ok ? '✅' : '❌');
    if (mRes.ok) {
        console.log('   Comercio:', mBody.data?.name || mBody.data?.legal_name);
    }

    const reference = `TEST-DIAG-${Date.now()}`;
    const amountInCents = 1000000;
    const currency = 'COP';

    console.log('\n2) Conversión monto (pesos → centavos)...');
    const centsFromPesos = amountToCents('104990.00');
    console.log('   104990.00 pesos →', centsFromPesos, 'centavos');

    console.log('\n3) Payload de firma...');
    const built = buildIntegrityPayload(reference, amountInCents, currency);
    console.log('   payloadPreview:', built.payloadPreview);
    console.log('   signature:', generateIntegritySignature(reference, amountInCents, currency));

    console.log('\n4) Web Checkout GET (puede dar falso positivo)...');
    const probe = await probeWebCheckout(reference, amountInCents, currency);
    console.log('   HTTP status:', probe.status, probe.ok ? '✅' : '❌');

    console.log('\n5) POST /transactions con tarjeta 4242... (prueba REAL de firma)');
    const txVerify = await verifyIntegrityWithWompiTransaction(`TX-VERIFY-${Date.now()}`, amountInCents);
    console.log('   Resultado:', txVerify.ok ? '✅ FIRMA VÁLIDA' : '❌ FALLO');
    if (!txVerify.ok) {
        console.log('   Detalle:', txVerify.error || txVerify.messages);
    } else {
        console.log('   Transacción test status:', txVerify.transactionStatus);
    }

    console.log('\n' + '='.repeat(50));
    if (txVerify.ok) {
        console.log('✅ Wompi OK — puedes pagar en checkout web.');
    } else if (txVerify.signatureInvalid) {
        console.log('❌ WOMPI_INTEGRITY_SECRET INCORRECTO');
        console.log('');
        console.log('El GET checkout puede decir 200 aunque el secreto esté mal.');
        console.log('Solución:');
        console.log('  1. Entra a https://comercios.wompi.co');
        console.log('  2. Desarrolladores → Secretos para integración técnica');
        console.log('  3. Copia el secreto de INTEGRIDAD (test_integrity_...)');
        console.log('     con Ctrl+A — revisa 0/O y 1/l');
        console.log('  4. Pégalo en .env → WOMPI_INTEGRITY_SECRET=...');
        console.log('  5. Reinicia el servidor y vuelve a correr: npm run diagnose:wompi');
        process.exit(1);
    } else {
        console.log('❌ Error Wompi:', txVerify.error);
        process.exit(1);
    }
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
