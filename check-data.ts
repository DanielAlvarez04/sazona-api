import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  // Find the user
  const user = await prisma.user.findUnique({
    where: { email: 'portafolio.d.alvarez@gmail.com' }
  })
  
  if (!user) {
    console.log('User not found')
    return
  }
  
  console.log('User found:', user.id, user.email)
  
  // Find organization
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id }
  })
  
  if (!membership) {
    console.log('No membership found')
    return
  }
  
  console.log('Organization:', membership.organizationId)
  
  // Check existing products
  const products = await prisma.product.findMany({
    where: { organizationId: membership.organizationId }
  })
  
  console.log('Existing products:', products.length)
  products.forEach(p => console.log(`- ${p.name} (${p.price})`))
  
  // Check categories
  const categories = await prisma.category.findMany({
    where: { 
      OR: [
        { organizationId: membership.organizationId },
        { organizationId: null }
      ]
    }
  })
  
  console.log('\nCategories:')
  categories.forEach(c => console.log(`- ${c.name} (${c.id})`))
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())