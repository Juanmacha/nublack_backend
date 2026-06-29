import dotenv from 'dotenv';
import crypto from 'crypto';
dotenv.config();

const pk = process.env.WOMPI_PUBLIC_KEY.trim();
const secret = process.env.WOMPI_INTEGRITY_SECRET.trim();

const sign = (ref, cents, expiration = null) => {
    const base = `${ref}${cents}COP`;
    const payload = expiration ? `${base}${expiration}${secret}` : `${base}${secret}`;
    return crypto.createHash('sha256').update(payload).digest('hex');
};

async function probe(label, ref, cents, extra = {}, expiration = null) {
    const params = {
        'public-key': pk,
        currency: 'COP',
        'amount-in-cents': String(cents),
        reference: ref,
        'signature:integrity': sign(ref, cents, expiration),
        ...extra
    };
    if (expiration) params['expiration-time'] = expiration;
    const res = await fetch(`https://checkout.wompi.co/p/?${new URLSearchParams(params)}`, { redirect: 'manual' });
    console.log(label, '→ HTTP', res.status);
}

const exp = '2026-06-29T20:00:00.000Z';
const ref = `EXP-${Date.now()}`;
const cents = 1000000;

await probe('Sin expiration', `A-${Date.now()}`, cents);
await probe('Con expiration firmada', ref, cents, {}, exp);
await probe('Con expiration en URL pero firma SIN expiration', `B-${Date.now()}`, cents, { 'expiration-time': exp });
await probe('Con email', `C-${Date.now()}`, cents, { 'customer-data:email': 'a@b.com' });
