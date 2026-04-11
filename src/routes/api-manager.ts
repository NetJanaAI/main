import express from 'express';
import { query } from '../lib/database';
import { encrypt, decrypt } from '../utils/crypto';
import { z } from 'zod';

const router = express.Router();

const CredentialSchema = z.object({
    provider: z.string().min(1),
    name: z.string().min(1),
    value: z.string().min(1)
});

router.get('/integrations', async (req: any, res) => {
    const orgId = req.organizationId;
    if (!orgId) return res.status(401).json({ error: 'Auth required' });

    const results = await query(
        'SELECT id, provider, credential_name FROM data_source_credentials WHERE organization_id = $1',
        [orgId]
    );
    res.json({ credentials: results.rows });
});

router.post('/integrations', async (req: any, res) => {
    const orgId = req.organizationId;
    if (!orgId) return res.status(401).json({ error: 'Auth required' });

    const validation = CredentialSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ error: 'Invalid payload' });

    const { provider, name, value } = validation.data;
    const encryptedValue = encrypt(value);

    await query(
        `INSERT INTO data_source_credentials (organization_id, provider, credential_name, credential_value)
         VALUES ($1, $2, $3, $4)`,
        [orgId, provider, name, encryptedValue]
    );

    res.json({ success: true });
});

router.delete('/integrations/:id', async (req: any, res) => {
    const orgId = req.organizationId;
    if (!orgId) return res.status(401).json({ error: 'Auth required' });

    await query('DELETE FROM data_source_credentials WHERE id = $1 AND organization_id = $2', [req.params.id, orgId]);
    res.json({ success: true });
});

export default router;
