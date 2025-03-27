import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import express from 'express'
import { google } from 'googleapis'
import { format } from 'fast-csv'
import fs from 'fs'
import path from 'path'
import iconv from 'iconv-lite'

// Configuração inicial do Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Erro: Configurações do Supabase ausentes');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

// Configuração do Google Sheets API
let sheets;
try {
  const auth = new google.auth.GoogleAuth({
    keyFile: 'credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  sheets = google.sheets({ version: 'v4', auth });
} catch (error) {
  console.error('Erro ao configurar Google Sheets API:', error);
  process.exit(1);
}

// Função para pegar dados do Google Sheets
const getSheetData = async (spreadsheetId, range) => {
  try {
    if (!spreadsheetId || !range) {
      throw new Error('ID da planilha e range são obrigatórios');
    }

    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rows = response.data.values;
    
    if (!rows || rows.length === 0) {
      throw new Error('Nenhum dado encontrado na planilha');
    }

    const headers = rows[0];
    return rows.slice(1).map(row => {
      return headers.reduce((obj, header, index) => {
        obj[header] = row[index] || '';
        return obj;
      }, {});
    });
  } catch (error) {
    console.error('Erro ao ler a planilha:', error);
    throw new Error(`Erro ao ler os dados da planilha: ${error.message}`);
  }
};

app.get('/metas', async (req, res) => {
  try {
    const data = await getSheetData('17eLFSX_N7855ZqvCc7YtQ1aw3q1jJ_cJPOE4GWX8wPU', 'A1:F15');
    res.json(data);
  } catch (error) {
    console.error('Erro na rota /metas:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar metas',
      message: error.message 
    });
  }
});

const queryDatabase = async (table, filters) => {
  try {
    if (!table) {
      throw new Error('Nome da tabela é obrigatório');
    }

    let query = supabase.from(table).select('*');
    if (filters && filters.length > 0) {
      filters.forEach(({ column, operator, value }) => {
        if (value) query = query[operator](column, value);
      });
    }
    
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data;
  } catch (error) {
    console.error(`Erro na query do banco de dados (tabela: ${table}):`, error);
    throw new Error(`Erro ao consultar banco de dados: ${error.message}`);
  }
};

app.get('/vendas', async (req, res) => {
  try {
    const { vendedor_id, equipe_id, data_inicio, data_fim } = req.query;
    
    if (data_fim && data_inicio && new Date(data_fim) < new Date(data_inicio)) {
      return res.status(400).json({ 
        error: 'Data inválida',
        message: 'A data fim deve ser posterior à data início' 
      });
    }

    const vendas = await queryDatabase('vendas', [
      { column: 'vendedor_id', operator: 'eq', value: vendedor_id },
      { column: 'equipe_id', operator: 'eq', value: equipe_id },
      { column: 'data_venda', operator: 'gte', value: data_inicio },
      { column: 'data_venda', operator: 'lte', value: data_fim },
    ]);

    res.json(vendas);
  } catch (error) {
    console.error('Erro na rota /vendas:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar vendas',
      message: error.message 
    });
  }
});

app.get('/produto/:id', async (req, res) => {
  try {
    if (!req.params.id) {
      return res.status(400).json({ 
        error: 'ID não fornecido',
        message: 'O ID do produto é obrigatório' 
      });
    }

    const produto = await queryDatabase('produtos', [{ column: 'id', operator: 'eq', value: req.params.id }]);
    
    if (!produto || produto.length === 0) {
      return res.status(404).json({ 
        error: 'Produto não encontrado',
        message: 'Nenhum produto encontrado com o ID fornecido' 
      });
    }

    res.json(produto);
  } catch (error) {
    console.error('Erro na rota /produto/:id:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar produto',
      message: error.message 
    });
  }
});

app.get('/equipes/:id/desempenho', async (req, res) => {
  try {
    const { id } = req.params;
    const { data_inicio, data_fim } = req.query;

    if (!id) {
      return res.status(400).json({ 
        error: 'ID não fornecido',
        message: 'O ID da equipe é obrigatório' 
      });
    }

    if (!data_inicio || !data_fim) {
      return res.status(400).json({ 
        error: 'Período não informado',
        message: 'É necessário informar o período (data_inicio e data_fim)' 
      });
    }

    let query = supabase
      .from('vendas')
      .select('*, vendedores!inner(equipe_id)')
      .eq('vendedores.equipe_id', id);

    if (data_inicio) query = query.gte('data_venda', data_inicio);
    if (data_fim) query = query.lte('data_venda', data_fim);

    const { data: vendas, error: vendasError } = await query;

    if (vendasError) {
      throw new Error(vendasError.message);
    }

    const { data: vendedores, error: vendedoresError } = await supabase
      .from('vendedores')
      .select('*')
      .eq('equipe_id', id);

    if (vendedoresError) {
      throw new Error(vendedoresError.message);
    }

    const totalVendas = vendas.length;
    const mediaVendasPorVendedor = vendedores.length > 0 ? totalVendas / vendedores.length : 0;

    res.json({
      total_vendas: totalVendas,
      media_vendas_por_vendedor: mediaVendasPorVendedor,
      periodo: {
        inicio: data_inicio,
        fim: data_fim
      }
    });
  } catch (error) {
    console.error('Erro na rota /equipes/:id/desempenho:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar desempenho da equipe',
      message: error.message 
    });
  }
});

app.get('/produtos/mais-vendidos', async (req, res) => {
  try {
    const { data_inicio, data_fim } = req.query;

    if (!data_inicio || !data_fim) {
      return res.status(400).json({ 
        error: 'Período não informado',
        message: 'É necessário informar o período (data_inicio e data_fim)' 
      });
    }

    const { data: vendas, error: vendasError } = await supabase
      .from('vendas')
      .select(`
        produto_id,
        produtos!inner (
          nome
        )
      `)
      .gte('data_venda', data_inicio)
      .lte('data_venda', data_fim);

    if (vendasError) {
      throw new Error(vendasError.message);
    }

    const produtosAgrupados = vendas.reduce((acc, venda) => {
      const produtoId = venda.produto_id;
      if (!acc[produtoId]) {
        acc[produtoId] = {
          produto_id: produtoId,
          nome: venda.produtos.nome,
          quantidade: 0
        };
      }
      acc[produtoId].quantidade += 1;
      return acc;
    }, {});

    const resultado = Object.values(produtosAgrupados)
      .sort((a, b) => b.quantidade - a.quantidade);

    return res.json(resultado);
  } catch (error) {
    console.error('Erro na rota /produtos/mais-vendidos:', error);
    return res.status(500).json({ 
      error: 'Erro ao buscar produtos mais vendidos',
      message: error.message 
    });
  }
});

const gerarCSVCombinado = async () => {
  try {
    const [vendas, vendedores, equipes] = await Promise.all([
      queryDatabase('vendas', []),
      queryDatabase('vendedores', []),
      queryDatabase('equipes', []),
    ]);

    if (!vendas || !vendedores || !equipes) {
      throw new Error('Erro ao buscar dados do banco de dados');
    }

    const filePath = path.join(__dirname, 'metas_combinadas.csv');
    const ws = fs.createWriteStream(filePath, { encoding: 'utf8' });
    const csvStream = format({ headers: true, quote: '"' });
    csvStream.pipe(ws);

    vendedores.forEach(vendedor => {
      try {
        csvStream.write({
          id: vendedor.id,
          nome: iconv.encode(vendedor.nome, 'utf8').toString(),
          meta: (Math.random() * (10000 - 5000) + 5000).toFixed(2),
          tipo: 'vendedor'
        });
      } catch (error) {
        console.error(`Erro ao processar vendedor ${vendedor.id}:`, error);
      }
    });

    equipes.forEach(equipe => {
      try {
        csvStream.write({
          id: equipe.id,
          nome: iconv.encode(equipe.nome, 'utf8').toString(),
          meta: (Math.random() * (10000 - 5000) + 5000).toFixed(2),
          tipo: 'equipe'
        });
      } catch (error) {
        console.error(`Erro ao processar equipe ${equipe.id}:`, error);
      }
    });

    csvStream.end();
    return filePath;
  } catch (error) {
    console.error('Erro ao gerar CSV:', error);
    throw new Error(`Erro ao gerar CSV: ${error.message}`);
  }
};

app.get('/gerar-csv-combinado', async (req, res) => {
  try {
    const filePath = await gerarCSVCombinado();
    res.download(filePath, 'metas_combinadas.csv', (err) => {
      if (err) {
        console.error('Erro ao enviar o arquivo:', err);
        res.status(500).json({ 
          error: 'Erro ao enviar arquivo',
          message: err.message 
        });
      }
    });
  } catch (error) {
    console.error('Erro na rota /gerar-csv-combinado:', error);
    res.status(500).json({ 
      error: 'Erro ao gerar CSV',
      message: error.message 
    });
  }
});

// Tratamento de erros global
app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err);
  res.status(500).json({ 
    error: 'Erro interno do servidor',
    message: err.message 
  });
});

app.listen(port, () => console.log(`Servidor rodando na porta ${port}`));