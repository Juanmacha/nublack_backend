import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';

/**
 * Autenticación opcional: adjunta usuario si hay token válido;
 * continúa como invitado si no hay token o es inválido.
 */
const optionalAuthMiddleware = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return next();
        }

        const parts = authHeader.split(' ');
        if (parts.length !== 2 || !/^Bearer$/i.test(parts[0])) {
            return next();
        }

        const token = parts[1];
        jwt.verify(
            token,
            config.jwtSecret || 'default_jwt_secret_key_please_change_in_production',
            (err, decoded) => {
                if (!err && decoded?.id) {
                    req.usuarioId = decoded.id;
                    req.usuarioRol = decoded.rol;
                }
                return next();
            }
        );
    } catch {
        return next();
    }
};

export default optionalAuthMiddleware;
