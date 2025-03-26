import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import express from 'express'
import { google } from 'googleapis'
import { format } from 'fast-csv'
import fs from 'fs'
import path from 'path'
import iconv from 'iconv-lite'
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
const app = express()
const port = 3000

// Configuração do Google Sheets API
const auth = new google.auth.GoogleAuth({
  keyFile: 'credentials.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
})

const sheets = google.sheets({ version: 'v4', auth })

// Rota para ler dados da planilha
app.get('/dados-planilha', async (req, res) => {
  try {
    const spreadsheetId = '17eLFSX_N7855ZqvCc7YtQ1aw3q1jJ_cJPOE4GWX8wPU'
    const range = 'A1:F15' // Ajuste o range conforme necessário

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    })

    const rows = response.data.values
    const headers = rows[0]
    const data = rows.slice(1).map(row => {
      const obj = {}
      headers.forEach((header, index) => {
        obj[header] = row[index]
      })
      return obj
    })

    res.json(data)
  } catch (error) {
    console.error('Erro ao ler a planilha:', error)
    res.status(500).json({ error: 'Erro ao ler os dados da planilha' })
  }
})

app.use(express.json())

const getRandomMeta = () => (Math.random() * (10000 - 5000) + 5000).toFixed(2);

app.get('/gerar-csv-combinado', async (req, res) => {
  try {
    const filePath = await gerarCSVCombinado()
    res.download(filePath, 'metas_combinadas.csv', (err) => {
      if (err) {
        console.error('Erro ao enviar o arquivo:', err)
        res.status(500).send('Erro ao gerar o CSV combinado')
      }
    })
  } catch (err) {
    console.error(err)
    res.status(500).send('Erro ao gerar o CSV combinado')
  }
})

// Rota para obter todas as vendas
app.get('/vendas', async (req, res) => {
  const { vendedor_id, equipe_id, data_inicio, data_fim } = req.query

  let query = supabase.from('vendas').select('*')

  if (vendedor_id) query = query.eq('vendedor_id', vendedor_id)
  if (equipe_id) query = query.eq('equipe_id', equipe_id)
  if (data_inicio) query = query.gte('data', data_inicio)
  if (data_fim) query = query.lte('data', data_fim)

  const { data, error } = await query

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  res.json(data)
})

// Rota para obter todos os vendedores
app.get('/vendedores', async (req, res) => {
  const { data, error } = await supabase.from('vendedores').select('*')

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  res.json(data)
})

// Rota para obter o desempenho da equipe
app.get('/equipes/:id/desempenho', async (req, res) => {
  const { id } = req.params
  const { data_inicio, data_fim } = req.query

  let query = supabase
    .from('vendas')
    .select('*')
    .eq('equipe_id', id)

  if (data_inicio) query = query.gte('data', data_inicio)
  if (data_fim) query = query.lte('data', data_fim)

  const { data: vendas, error: vendasError } = await query

  if (vendasError) {
    return res.status(500).json({ error: vendasError.message })
  }

  const { data: vendedores, error: vendedoresError } = await supabase
    .from('vendedores')
    .select('*')
    .eq('equipe_id', id)

  if (vendedoresError) {
    return res.status(500).json({ error: vendedoresError.message })
  }

  const totalVendas = vendas.length
  const mediaVendasPorVendedor = vendedores.length > 0 ? totalVendas / vendedores.length : 0

  res.json({
    total_vendas: totalVendas,
    media_vendas_por_vendedor: mediaVendasPorVendedor,
    periodo: {
      inicio: data_inicio,
      fim: data_fim
    }
  })
})

// Função para gerar o CSV de metas EXTRA
const gerarCSVCombinado = async () => {
  // Buscar vendas e vendedores
  const { data: vendas, error: vendasError } = await supabase
    .from('vendas')
    .select('vendedor_id')

  if (vendasError) {
    console.error('Erro ao buscar vendas:', vendasError.message)
    throw new Error('Erro ao buscar vendas')
  }

  const vendedoresIds = [...new Set(vendas.map(venda => venda.vendedor_id))]

  const { data: vendedores, error: vendedoresError } = await supabase
    .from('vendedores')
    .select('*')
    .in('id', vendedoresIds)

  if (vendedoresError) {
    console.error('Erro ao buscar vendedores:', vendedoresError.message)
    throw new Error('Erro ao buscar vendedores')
  }

  const { data: equipes, error: equipesError } = await supabase
    .from('equipes')
    .select('*')

  if (equipesError) {
    console.error('Erro ao buscar equipes:', equipesError.message)
    throw new Error('Erro ao buscar equipes')
  }

  const dataAtual = new Date()
  const anoMes = `${dataAtual.getFullYear()}-${(dataAtual.getMonth() + 1).toString().padStart(2, '0')}`

  const filePath = path.join('/', 'metas_combinadas.csv')
  const ws = fs.createWriteStream(filePath, { encoding: 'utf8' })

  const csvStream = format({ headers: true, quote: '"' })
  csvStream.pipe(ws)

  vendedores.forEach(vendedor => {
    csvStream.write({
      id: vendedor.id,
      nome: iconv.encode(vendedor.nome, 'utf8').toString(),
      meta: getRandomMeta(),
      periodo: anoMes,
      tipo: 'vendedor'
    })
  })
  
  equipes.forEach(equipe => {
    csvStream.write({
      id: equipe.id,
      nome: iconv.encode(equipe.nome, 'utf8').toString(),
      meta: getRandomMeta(),
      periodo: anoMes,
      tipo: 'equipe'
    })
  })

  csvStream.end()

  return filePath
}


app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`)
})
