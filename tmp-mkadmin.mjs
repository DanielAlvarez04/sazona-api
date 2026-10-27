import argon2 from "argon2"
import pg from "pg"

const ORG = "cmvov00r7002irgl016mtbo67"
const id = "tmpagent0001"
const hash = await argon2.hash("Naranja123!", { type: argon2.argon2id })

const client = new pg.Client({ connectionString: "postgresql://np_user:np_password@localhost:55432/np_db?schema=public" })
await client.connect()

await client.query(
  `INSERT INTO "User" (id, username, email, name, "passwordHash", "isActive", "emailVerified", "onboardedAt", "createdAt", "updatedAt")
   VALUES ($1, $2, $3, $4, $5, true, true, now(), now(), now())
   ON CONFLICT (id) DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash", "isActive" = true, "onboardedAt" = now(), "updatedAt" = now()`,
  [id, "tmp.agent@naranjapimienta.cafe", "tmp.agent@naranjapimienta.cafe", "Tmp Agent", hash]
)

await client.query(
  `INSERT INTO "Membership" (id, "userId", "organizationId", roles, "isActive", "createdAt", "updatedAt")
   VALUES ($1, $2, $3, ARRAY['ADMIN']::"Role"[], true, now(), now())
   ON CONFLICT (id) DO UPDATE SET roles = ARRAY['ADMIN']::"Role"[], "isActive" = true, "updatedAt" = now()`,
  ["tmpmembership0001", id, ORG]
)

console.log("ok")
await client.end()
