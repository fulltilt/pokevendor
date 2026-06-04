# Database Transfer Quick Notes

From project root:

```bash
npm run db:backup
```

This creates a compressed dump in `backups/`.

On the target laptop (after copying the dump file and starting docker):

```bash
npm run db:restore -- backups/your-backup-file.sql.gz
```

Or restore the newest dump automatically:

```bash
npm run db:restore
```
