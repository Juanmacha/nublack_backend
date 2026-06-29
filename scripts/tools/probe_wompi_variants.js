import dotenv from 'dotenv';
import crypto from 'crypto';
dotenv.config();

const pk = process.env.WOMPI_PUBLIC_KEY.trim();
const secret = process.env.WOMPI_INTEGRITY_SECRET.trim();
const prv = process.env.WOMPI_PRIVATE_KEY.trim();

const sign = (ref, cents) =>
    crypto.createHash('sha256').update(`${ref}${cents}COP${secret}`).digest('hex');

async function probeCheckout(label, ref, extra = {}) {
    const cents = 1000000;
    const params = {
        'public-key': pk,
        currency: 'COP',
        'amount-in-cents': String(cents),
        reference: ref,
        'signature:integrity': sign(ref, cents),
        ...extra
    };
    const res = await fetch(`https://checkout.wompi.co/p/?${new URLSearchParams(params)}`, { redirect: 'manual' });
    console.log(label, '→ HTTP', res.status);
}

const m = await (await fetch(`https://sandbox.wompi.co/v1/merchants/${pk}`)).json();
const acceptance = m.data.presigned_acceptance.acceptance_token;
const ref = `APITEST-${Date.now()}`;
const cents = 1000000;

await probeCheckout('Checkout sin redirect', `WEB1-${Date.now()}`);
await probeCheckout('Checkout redirect localhost', `WEB2-${Date.now()}`, {
    'redirect-url': process.env.WOMPI_REDIRECT_URL
});
await probeCheckout('Checkout redirect wompi test', `WEB3-${Date.now()}`, {
    'redirect-url': 'https://transaction-redirect.wompi.co/check'
});
await probeCheckout('Checkout redirect nublack12', `WEB4-${Date.now()}`, {
    'redirect-url': 'https://nublack12.com/pago/resultado'
});

const txRes = await fetch('https://sandbox.wompi.co/v1/transactions', {
    method: 'POST',
    headers: {
        Authorization: `Bearer ${prv}`,
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        acceptance_token: acceptance,
        amount_in_cents: cents,
        currency: 'COP',
        customer_email: 'test@test.com',
        reference: ref,
        signature: sign(ref, cents),
        payment_method_type: 'CARD',
        payment_method: { installments: 1 }
    })
});
const txBody = await txRes.json();
console.log('API POST /transactions → HTTP', txRes.status);
if (txBody.error) console.log('  error:', txBody.error.type, txBody.error.reason || txBody.error.messages);
else console.log('  tx id:', txBody.data?.id);
