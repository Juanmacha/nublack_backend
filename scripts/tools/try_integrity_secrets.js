import dotenv from 'dotenv';
import crypto from 'crypto';
dotenv.config();

const SECRETS = {
    fromImage: 'test_integrity_y0StDU7QDwxf4GnX6LF70cZS1JXC4SVH',
    fromEnv: process.env.WOMPI_INTEGRITY_SECRET?.trim(),
    oldTypo: 'test_integrity_yOStDU7QDwxf4GnX6LF70cZS1JXC4SVH'
};

const pub = process.env.WOMPI_PUBLIC_KEY.trim();
const prv = process.env.WOMPI_PRIVATE_KEY.trim();

const sign = (ref, cents, secret) =>
    crypto.createHash('sha256').update(`${ref}${cents}COP${secret}`).digest('hex');

async function tryPay(label, secret) {
    const m = await (await fetch(`https://sandbox.wompi.co/v1/merchants/${pub}`)).json();
    const tok = await (await fetch('https://sandbox.wompi.co/v1/tokens/cards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${pub}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: '4242424244244242', cvc: '123', exp_month: '12', exp_year: '29', card_holder: 'Test' })
    })).json();

    const ref = `TRY-${label}-${Date.now()}`;
    const cents = 1000000;
    const signature = sign(ref, cents, secret);

    const r = await fetch('https://sandbox.wompi.co/v1/transactions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${prv}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            acceptance_token: m.data.presigned_acceptance.acceptance_token,
            amount_in_cents: cents,
            currency: 'COP',
            customer_email: 't@t.com',
            reference: ref,
            signature,
            payment_method_type: 'CARD',
            payment_method: { type: 'CARD', token: tok.data.id, installments: 1 }
        })
    });
    const b = await r.json();
    const sigErr = b.error?.messages?.signature;
    console.log(`${label} (len=${secret.length}):`, sigErr ? '❌ firma inválida' : `✅ HTTP ${r.status} status=${b.data?.status}`);
    if (!sigErr && b.data?.status) return true;
    return false;
}

console.log('Comercio:', (await (await fetch(`https://sandbox.wompi.co/v1/merchants/${pub}`)).json()).data?.name);
console.log('pub:', pub.slice(0, 20) + '...');
console.log('env secret chars:', [...SECRETS.fromEnv].map((c) => c.charCodeAt(0)).join(','));

for (const [label, secret] of Object.entries(SECRETS)) {
    if (secret) await tryPay(label, secret);
}
