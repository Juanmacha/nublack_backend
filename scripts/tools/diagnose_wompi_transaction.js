/**
 * Prueba POST /transactions en sandbox (misma firma que checkout).
 * Uso: node scripts/tools/diagnose_wompi_transaction.js
 */
import dotenv from 'dotenv';
dotenv.config();

const { wompiConfig } = await import('../../src/config/wompi.js');
const { generateIntegritySignature, probeWebCheckout } = await import('../../src/services/wompiService.js');

const publicKey = wompiConfig.publicKey;
const privateKey = wompiConfig.privateKey;

async function run() {
    console.log('=== Diagnóstico POST /transactions (sandbox) ===\n');

    const merchantRes = await fetch(`https://sandbox.wompi.co/v1/merchants/${encodeURIComponent(publicKey)}`);
    const merchant = await merchantRes.json();
    if (!merchantRes.ok) {
        console.error('Merchant API falló:', merchantRes.status, merchant);
        process.exit(1);
    }

    const acceptanceToken = merchant.data?.presigned_acceptance?.acceptance_token;
    console.log('Comercio:', merchant.data?.name);
    console.log('Integrity secret length:', wompiConfig.integritySecret.length);

    const reference = `TX-DIAG-${Date.now()}`;
    const amountInCents = 1000000;
    const expirationTime = new Date(Date.now() + 40 * 60 * 1000).toISOString();
    const signature = generateIntegritySignature(reference, amountInCents, 'COP', wompiConfig.integritySecret, expirationTime);

    console.log('\n1) Checkout GET (con expiration-time)...');
    const probe = await probeWebCheckout(reference, amountInCents, 'COP', expirationTime);
    console.log('   HTTP', probe.status, probe.ok ? '✅' : '❌');

    console.log('\n2) POST /transactions (misma firma con expiration)...');
    const txRes = await fetch('https://sandbox.wompi.co/v1/transactions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${privateKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            acceptance_token: acceptanceToken,
            amount_in_cents: amountInCents,
            currency: 'COP',
            customer_email: 'test@nublack.local',
            reference,
            signature,
            payment_method_type: 'CARD',
            payment_method: { installments: 1 }
        })
    });

    const txBody = await txRes.json();
    console.log('   HTTP', txRes.status, txRes.ok ? '✅' : '❌');
    if (txBody.error) {
        console.log('   error.type:', txBody.error.type);
        console.log('   error.reason:', txBody.error.reason);
        console.log('   error.messages:', JSON.stringify(txBody.error.messages || txBody.error, null, 2));
    } else {
        console.log('   tx id:', txBody.data?.id);
        console.log('   status:', txBody.data?.status);
    }

    if (txRes.status === 422 && txBody.error?.messages?.signature) {
        console.log('\n❌ Wompi rechaza la firma en POST /transactions.');
        console.log('   El secreto WOMPI_INTEGRITY_SECRET no coincide con pub_test_... en dashboard.');
    } else if (txRes.ok || txRes.status === 201) {
        console.log('\n✅ Firma válida para crear transacciones.');
        console.log('   Si el widget falla, el problema es del navegador/widget, no del backend.');
    }
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
