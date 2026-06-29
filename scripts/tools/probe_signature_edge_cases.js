import dotenv from 'dotenv';
dotenv.config();

const { probeWebCheckout, generateIntegritySignature } = await import('../../src/services/wompiService.js');

const secret = process.env.WOMPI_INTEGRITY_SECRET;
console.log('secret length:', secret.length);
console.log('secret JSON:', JSON.stringify(secret));

const ref = `NUBLACK-ORD-TEST-${Date.now()}`;
const cents = 10499000;
const probe = await probeWebCheckout(ref, cents);
console.log('probe large amount:', probe.status, probe.ok ? 'OK' : 'FAIL');

const pk = process.env.WOMPI_PUBLIC_KEY.trim();
const prv = process.env.WOMPI_PRIVATE_KEY.trim();
const m = await (await fetch(`https://sandbox.wompi.co/v1/merchants/${pk}`)).json();
const acc = m.data.presigned_acceptance.acceptance_token;
const dupRef = `DUP-${Date.now()}`;
const dupSig = generateIntegritySignature(dupRef, 1000000);

const body = {
    acceptance_token: acc,
    amount_in_cents: 1000000,
    currency: 'COP',
    customer_email: 't@t.com',
    reference: dupRef,
    signature: dupSig,
    payment_method_type: 'NEQUI'
};

const post = (payload) => fetch('https://sandbox.wompi.co/v1/transactions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${prv}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
});

const r1 = await post(body);
const b1 = await r1.json();
console.log('first POST', r1.status, b1.error?.type, JSON.stringify(b1.error?.messages || b1.data?.id || {}));

const r2 = await post(body);
const b2 = await r2.json();
console.log('duplicate POST', r2.status, b2.error?.type, JSON.stringify(b2.error?.messages || {}));
