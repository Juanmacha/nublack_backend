/**
 * Pago sandbox completo vía API (sin navegador).
 * Confirma si la firma e integridad están bien.
 * Uso: node scripts/tools/pay_wompi_sandbox.js
 */
import dotenv from 'dotenv';
dotenv.config();

const BASE = 'https://sandbox.wompi.co/v1';
const pub = process.env.WOMPI_PUBLIC_KEY.trim();
const prv = process.env.WOMPI_PRIVATE_KEY.trim();
const { generateIntegritySignature } = await import('../../src/services/wompiService.js');

async function run() {
    console.log('=== Pago sandbox vía API (4242...) ===\n');

    const merchantRes = await fetch(`${BASE}/merchants/${pub}`);
    const merchant = await merchantRes.json();
    if (!merchantRes.ok) {
        console.error('Merchant error:', merchant);
        process.exit(1);
    }
    const acceptanceToken = merchant.data.presigned_acceptance.acceptance_token;
    console.log('Comercio:', merchant.data.name);

    const tokenRes = await fetch(`${BASE}/tokens/cards`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${pub}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            number: '4242424242424242',
            cvc: '123',
            exp_month: '12',
            exp_year: '29',
            card_holder: 'Test Nublack'
        })
    });
    const tokenBody = await tokenRes.json();
    if (!tokenRes.ok) {
        console.error('Tokenize error:', tokenRes.status, JSON.stringify(tokenBody, null, 2));
        process.exit(1);
    }
    const cardToken = tokenBody.data?.id;
    console.log('Token tarjeta:', cardToken?.slice(0, 20) + '...');

    const reference = `API-PAY-${Date.now()}`;
    const amountInCents = 1000000;
    const signature = generateIntegritySignature(reference, amountInCents);

    const txRes = await fetch(`${BASE}/transactions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${prv}`,
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
            payment_method: {
                type: 'CARD',
                token: cardToken,
                installments: 1
            }
        })
    });
    const txBody = await txRes.json();

    console.log('\nPOST /transactions → HTTP', txRes.status);
    console.log(JSON.stringify(txBody, null, 2));

    if (txBody.error?.messages?.signature) {
        console.log('\n❌ FIRMA INVÁLIDA — WOMPI_INTEGRITY_SECRET no coincide con pub_test_ en dashboard.');
        console.log('   Ve a comercios.wompi.co → Desarrolladores → Secretos → Integridad');
        console.log('   Copia el secreto COMPLETO (Ctrl+A) y actualiza .env');
    } else if (txRes.status === 201 || txBody.data?.status) {
        console.log('\n✅ Pago API OK — status:', txBody.data?.status);
        console.log('   El backend/firma están bien. El error en navegador es del checkout web de Wompi.');
    }
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
