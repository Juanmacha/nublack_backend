-- =============================================================================
-- Nublack — Reconciliación de stock y soporte de pedidos invitado
-- Ejecutar en MySQL (Hostinger phpMyAdmin o cliente CLI)
-- =============================================================================
-- IMPORTANTE: Haz backup antes de ejecutar la sección de ACTUALIZACIÓN.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) DIAGNÓSTICO: productos con tallas donde stock total ≠ suma de tallas
-- -----------------------------------------------------------------------------
-- Nota: tallas puede ser JSON array [{talla, stock}] u objeto {M: 5, L: 3}

SELECT
    p.id_producto,
    p.nombre,
    p.stock AS stock_actual,
    CASE
        WHEN JSON_TYPE(p.tallas) = 'ARRAY' THEN (
            SELECT COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(p.tallas, CONCAT('$[', n.i, '].stock'))) AS SIGNED)), 0)
            FROM (
                SELECT 0 AS i UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
                UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9
                UNION SELECT 10 UNION SELECT 11 UNION SELECT 12 UNION SELECT 13 UNION SELECT 14
                UNION SELECT 15 UNION SELECT 16 UNION SELECT 17 UNION SELECT 18 UNION SELECT 19
            ) n
            WHERE JSON_EXTRACT(p.tallas, CONCAT('$[', n.i, '].stock')) IS NOT NULL
        )
        WHEN JSON_TYPE(p.tallas) = 'OBJECT' THEN (
            SELECT COALESCE(SUM(CAST(JSON_UNQUOTE(value) AS SIGNED)), 0)
            FROM JSON_TABLE(
                JSON_KEYS(p.tallas),
                '$[*]' COLUMNS (size_key VARCHAR(20) PATH '$')
            ) keys_tbl
            JOIN JSON_TABLE(
                p.tallas,
                '$.*' COLUMNS (value JSON PATH '$')
            ) vals ON 1=1
        )
        ELSE p.stock
    END AS stock_calculado_tallas,
    p.tallas
FROM productos p
WHERE p.tallas IS NOT NULL
  AND p.tallas != 'null'
  AND p.tallas != '[]'
  AND p.tallas != '{}'
HAVING stock_actual != stock_calculado_tallas;

-- Versión simplificada (MySQL 8+) si la anterior falla en tu hosting:
-- Lista productos con tallas para revisión manual
SELECT id_producto, nombre, stock, tallas
FROM productos
WHERE tallas IS NOT NULL
  AND tallas NOT IN ('null', '[]', '{}', '');

-- -----------------------------------------------------------------------------
-- 2) ACTUALIZACIÓN: alinear stock total con suma de tallas (productos con tallas)
-- -----------------------------------------------------------------------------
-- Ejecutar solo tras revisar el diagnóstico.

START TRANSACTION;

-- 2a) Tallas en formato array [{ "talla": "M", "stock": 5 }, ...]
UPDATE productos p
SET p.stock = (
    SELECT COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(p.tallas, CONCAT('$[', n.i, '].stock'))) AS SIGNED)), 0)
    FROM (
        SELECT 0 AS i UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
        UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9
        UNION SELECT 10 UNION SELECT 11 UNION SELECT 12 UNION SELECT 13 UNION SELECT 14
        UNION SELECT 15 UNION SELECT 16 UNION SELECT 17 UNION SELECT 18 UNION SELECT 19
    ) n
    WHERE JSON_EXTRACT(p.tallas, CONCAT('$[', n.i, '].stock')) IS NOT NULL
)
WHERE JSON_TYPE(p.tallas) = 'ARRAY'
  AND JSON_LENGTH(p.tallas) > 0;

-- 2b) Tallas en formato objeto { "M": 5, "L": 3 }
-- (requiere MySQL 8.0.4+ con JSON_TABLE)
UPDATE productos p
INNER JOIN (
    SELECT
        p2.id_producto,
        COALESCE(SUM(CAST(JSON_UNQUOTE(jt.val) AS SIGNED)), 0) AS suma_stock
    FROM productos p2
    CROSS JOIN JSON_TABLE(
        JSON_KEYS(p2.tallas),
        '$[*]' COLUMNS (k VARCHAR(20) PATH '$')
    ) keys_jt
    CROSS JOIN JSON_TABLE(
        p2.tallas,
        '$.*' COLUMNS (val JSON PATH '$')
    ) jt
    WHERE JSON_TYPE(p2.tallas) = 'OBJECT'
      AND JSON_LENGTH(JSON_KEYS(p2.tallas)) > 0
    GROUP BY p2.id_producto
) calc ON calc.id_producto = p.id_producto
SET p.stock = calc.suma_stock
WHERE JSON_TYPE(p.tallas) = 'OBJECT'
  AND JSON_LENGTH(JSON_KEYS(p.tallas)) > 0;

COMMIT;

-- Verificación post-actualización
SELECT id_producto, nombre, stock, tallas FROM productos ORDER BY id_producto;

-- -----------------------------------------------------------------------------
-- 3) MIGRACIÓN: permitir pedidos de invitado (usuario_id NULL)
-- -----------------------------------------------------------------------------
-- Permite checkout sin cuenta; los datos del cliente van en solicitudes.*

ALTER TABLE solicitudes
    MODIFY COLUMN usuario_id INT NULL;

-- Verificar
SHOW COLUMNS FROM solicitudes LIKE 'usuario_id';

-- -----------------------------------------------------------------------------
-- 4) OPCIONAL: índice para buscar pedidos invitado por correo
-- -----------------------------------------------------------------------------
CREATE INDEX idx_solicitudes_correo ON solicitudes (correo_electronico);

-- -----------------------------------------------------------------------------
-- 5) Ubicación de entrega y transportadora
-- -----------------------------------------------------------------------------
ALTER TABLE solicitudes
    ADD COLUMN departamento VARCHAR(100) NULL,
    ADD COLUMN ciudad VARCHAR(100) NULL,
    ADD COLUMN transportadora_envio VARCHAR(150) NULL;
