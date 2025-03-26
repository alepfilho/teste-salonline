import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { faker } from '@faker-js/faker/locale/pt_BR'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

async function seedProdutos() {
  const produtos = [
    {
      nome: 'Kit Completo SOS Cachos De Repente Pronta!',
      categoria: 'Kit de tratamento'
    },
    {
      nome: 'Kit Shampoo e Condicionador Chocolate #todecacho Kids',
      categoria: 'Cheirinho de frutas'
    },
    {
      nome: 'Shampoo SOS Bomba Original Salon Line 500ml',
      categoria: 'Shampoo'
    },
    {
      nome: 'Kit completo sachês para viagem',
      categoria: 'Sos cachos'
    }
  ]

  const { data, error } = await supabase
    .from('produtos')
    .insert(produtos)
    .select()

  if (error) {
    console.error('Erro ao inserir produtos:', error)
    return null
  }
  return data
}

async function seedEquipes() {
  const equipes = Array.from({ length: 4 }, () => ({
    nome: faker.person.fullName()
  }))

  const { data, error } = await supabase
    .from('equipes')
    .insert(equipes)
    .select()

  if (error) {
    console.error('Erro ao inserir equipes:', error)
    return null
  }
  return data
}

async function seedVendedores(equipes) {
  if (!equipes || equipes.length === 0) {
    console.error('Nenhuma equipe encontrada para associar aos vendedores')
    return
  }

  const vendedores = Array.from({ length: 10 }, () => ({
    nome: faker.person.fullName(),
    telefone: faker.phone.number('(##) #####-####'),
    email: faker.internet.email(),
    equipe_id: equipes[Math.floor(Math.random() * equipes.length)].id,
  }))

  const { data, error } = await supabase
    .from('vendedores')
    .insert(vendedores)
    .select()

  if (error) {
    console.error('Erro ao inserir vendedores:', error)
    return null
  }
  return data
}

async function seedVendas(vendedores, produtos) {
  if (!vendedores || vendedores.length === 0 || !produtos || produtos.length === 0) {
    console.error('Vendedores ou produtos não encontrados para criar vendas')
    return
  }

  const vendas = Array.from({ length: 500 }, () => ({
    vendedor_id: vendedores[Math.floor(Math.random() * vendedores.length)].id,
    produto_id: produtos[Math.floor(Math.random() * produtos.length)].id,
    quantidade: Math.floor(Math.random() * 10) + 1,
    data_venda: faker.date.between({ from: '2025-03-01', to: '2025-03-31' }).toISOString(),
    valor_total: Math.floor(Math.random() * 100) + 1
  }))

  const { data, error } = await supabase
    .from('vendas')
    .insert(vendas)
    .select()

  if (error) {
    console.error('Erro ao inserir vendas:', error)
    return null
  }
  return data
}

async function main() {
  try {
    console.log('Iniciando seed...')

    const produtos = await seedProdutos()
    console.log('Produtos inseridos:', produtos?.length || 0)

    const equipes = await seedEquipes()
    console.log('Equipes inseridas:', equipes?.length || 0)

    const vendedores = await seedVendedores(equipes)
    console.log('Vendedores inseridos:', vendedores?.length || 0)

    const vendas = await seedVendas(vendedores, produtos)
    console.log('Vendas inseridas:', vendas?.length || 0)

    console.log('Seed concluído com sucesso!')
  } catch (error) {
    console.error('Erro durante o seed:', error)
  }
}

main() 