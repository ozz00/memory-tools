import JSZip from 'jszip';
import initSqlJs from 'sql.js';
import { FlashCard, DmaicStage, ParseResult } from '../types';

// Helper to determine DMAIC stage from text or tags
export function detectDmaicStage(text: string, tags: string[] = []): DmaicStage {
  const combined = (text + ' ' + tags.join(' ')).toLowerCase();
  
  if (combined.includes('dfma') || combined.includes('dfss') || combined.includes('dfmac') || combined.includes('设计')) {
    return 'dfss';
  }
  if (combined.includes('smed') || combined.includes('精益') || combined.includes('lean') || combined.includes('vsm') || combined.includes('看板') || combined.includes('5s') || combined.includes('防错')) {
    return 'lean';
  }
  if (combined.includes('spc') || combined.includes('控制图') || combined.includes('控制') || combined.includes('control') || combined.includes('sop') || combined.includes('判异')) {
    return 'control';
  }
  if (combined.includes('doe') || combined.includes('改进') || combined.includes('improve') || combined.includes('试验设计') || combined.includes('响应曲面') || combined.includes('全因子')) {
    return 'improve';
  }
  if (combined.includes('检验') || combined.includes('分析') || combined.includes('analyze') || combined.includes('anova') || combined.includes('方差分析') || combined.includes('回归') || combined.includes('p-value') || combined.includes('p值') || combined.includes('t检验')) {
    return 'analyze';
  }
  if (combined.includes('msa') || combined.includes('测量') || combined.includes('measure') || combined.includes('grr') || combined.includes('cpk') || combined.includes('ppk') || combined.includes('过程能力') || combined.includes('量具')) {
    return 'measure';
  }
  if (combined.includes('界定') || combined.includes('define') || combined.includes('charter') || combined.includes('voc') || combined.includes('kpov') || combined.includes('kpiv') || combined.includes('sipoc') || combined.includes('立项')) {
    return 'define';
  }
  return 'overview';
}

// Clean HTML / Cloze formatting
export function cleanAnkiHtml(raw: string): string {
  if (!raw) return '';
  // Convert Cloze {{c1::answer}} to styled span
  let cleaned = raw.replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, '<span class="px-1 py-0.5 mx-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-semibold">$1</span>');
  
  // Replace multiple line breaks
  cleaned = cleaned.replace(/&nbsp;/g, ' ').trim();
  return cleaned;
}

// Extract choice options (A, B, C, D) if present in text
export function extractChoiceOptions(text: string): { question: string; options?: string[]; correctAnswer?: string } {
  // Check if text has options like A. xxx B. xxx
  const optionRegex = /([A-D][.、\s][^\n]+)/g;
  const matches = text.match(optionRegex);
  
  if (matches && matches.length >= 2) {
    const question = text.split(/[A-D][.、\s]/)[0].trim();
    const options = matches.map(m => m.trim());
    return { question: question || text, options };
  }

  return { question: text };
}

// Parse text/TSV content (exported from Anki)
export function parseAnkiText(content: string): ParseResult {
  try {
    const lines = content.split(/\r?\n/);
    const cards: FlashCard[] = [];
    const now = Date.now();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;

      // Anki TXT export is typically tab-delimited
      const fields = line.split('\t');
      if (fields.length < 2) continue;

      const rawFront = cleanAnkiHtml(fields[0]);
      const rawBack = cleanAnkiHtml(fields[1]);
      const rawTags = fields[2] ? fields[2].split(/\s+/).filter(Boolean) : [];

      const { question, options } = extractChoiceOptions(rawFront);
      const stage = detectDmaicStage(rawFront + ' ' + rawBack, rawTags);

      const card: FlashCard = {
        id: `import-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        front: question,
        back: rawBack,
        options: options && options.length > 0 ? options : undefined,
        stage,
        tags: rawTags.length > 0 ? rawTags : ['Anki导入', stage],
        cardType: options && options.length > 0 ? 'single_choice' : 'flashcard',
        interval: 0,
        repetitions: 0,
        easeFactor: 2.5,
        nextReviewDate: now,
        state: 'new',
      };

      cards.push(card);
    }

    if (cards.length === 0) {
      return {
        success: false,
        totalParsed: 0,
        cards: [],
        message: '未能从文本中提取到有效的 Anki 卡片，请确认每行正面与背面是否使用 Tab (制表符) 分隔。'
      };
    }

    return {
      success: true,
      totalParsed: cards.length,
      cards,
      message: `成功解析 ${cards.length} 张 Anki 卡片！`
    };
  } catch (err: any) {
    return {
      success: false,
      totalParsed: 0,
      cards: [],
      message: '解析失败: ' + (err.message || '未知格式错误'),
      error: String(err)
    };
  }
}

// Parse .apkg / .zip package containing SQLite database
export async function parseAnkiApkg(fileBuffer: ArrayBuffer): Promise<ParseResult> {
  try {
    const zip = await JSZip.loadAsync(fileBuffer);
    
    // Find collection.anki21 or collection.anki2
    let dbFile = zip.file('collection.anki21') || zip.file('collection.anki2');
    
    if (!dbFile) {
      // Look for any .anki2 in the archive
      const files = Object.keys(zip.files);
      const matched = files.find(f => f.endsWith('.anki2') || f.endsWith('.anki21'));
      if (matched) {
        dbFile = zip.file(matched);
      }
    }

    if (!dbFile) {
      // Check if it's a plain zip with text files or json
      const txtFile = Object.values(zip.files).find(f => f.name.endsWith('.txt') || f.name.endsWith('.tsv') || f.name.endsWith('.csv'));
      if (txtFile) {
        const textContent = await txtFile.async('string');
        return parseAnkiText(textContent);
      }
      throw new Error('未在压缩包中找到 Anki 核心数据库文件 (collection.anki2 或 collection.anki21)');
    }

    const dbData = await dbFile.async('uint8array');

    // Initialize SQL.js
    let SQL: any;
    try {
      SQL = await initSqlJs({
        locateFile: (file: string) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.12.0/${file}`
      });
    } catch (e) {
      // Fallback local init if cdn fails
      SQL = await initSqlJs();
    }

    const db = new SQL.Database(dbData);
    
    // Query notes table
    // Anki notes schema: id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data
    const queryResult = db.exec("SELECT id, tags, flds FROM notes");
    
    if (!queryResult || queryResult.length === 0 || !queryResult[0].values) {
      throw new Error('Anki 数据库读取成功，但 notes 表为空。');
    }

    const rows = queryResult[0].values;
    const cards: FlashCard[] = [];
    const now = Date.now();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const tagsStr = (row[1] as string) || '';
      const fldsStr = (row[2] as string) || '';

      // In Anki, fields are separated by ASCII 31 (\x1f)
      const fieldParts = fldsStr.split('\x1f');
      if (fieldParts.length === 0) continue;

      const rawFront = cleanAnkiHtml(fieldParts[0] || '');
      const rawBack = cleanAnkiHtml(fieldParts[1] || fieldParts[2] || '');
      const extra = fieldParts[3] ? cleanAnkiHtml(fieldParts[3]) : undefined;
      const tags = tagsStr.split(/\s+/).filter(Boolean);

      if (!rawFront && !rawBack) continue;

      const { question, options } = extractChoiceOptions(rawFront);
      const stage = detectDmaicStage(rawFront + ' ' + rawBack, tags);

      const card: FlashCard = {
        id: `apkg-${row[0] || i}-${Date.now().toString(36)}`,
        front: question || rawFront,
        back: rawBack || '（暂无详细解析）',
        explanation: extra,
        options: options && options.length > 0 ? options : undefined,
        stage,
        tags: tags.length > 0 ? tags : ['Anki导入', stage],
        cardType: options && options.length > 0 ? 'single_choice' : 'flashcard',
        interval: 0,
        repetitions: 0,
        easeFactor: 2.5,
        nextReviewDate: now,
        state: 'new',
      };

      cards.push(card);
    }

    db.close();

    return {
      success: true,
      totalParsed: cards.length,
      cards,
      message: `成功解包并解析 .apkg 数据库！共提取 ${cards.length} 张六西格玛卡片。`
    };
  } catch (err: any) {
    // If sql.js fails or is not supported, attempt binary string extraction for resilience
    console.warn('SQL parsing fallback triggered:', err);
    return fallbackExtractAnkiBinary(fileBuffer);
  }
}

// Resilient fallback: extracts flds patterns from raw bytes if SQLite fails
async function fallbackExtractAnkiBinary(fileBuffer: ArrayBuffer): Promise<ParseResult> {
  try {
    const zip = await JSZip.loadAsync(fileBuffer);
    const dbFile = zip.file('collection.anki21') || zip.file('collection.anki2');
    
    if (!dbFile) {
      throw new Error('未找到 collection.anki2 文件');
    }

    const uint8 = await dbFile.async('uint8array');
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const text = decoder.decode(uint8);

    // Look for fields separated by \x1f
    const cards: FlashCard[] = [];
    const parts = text.split('\x1f');
    const now = Date.now();

    for (let i = 0; i < parts.length - 1; i += 2) {
      const frontCandidate = parts[i].trim();
      const backCandidate = parts[i + 1].trim();

      // Basic sanity check on length and printable characters
      if (frontCandidate.length > 4 && frontCandidate.length < 1500 && backCandidate.length > 2) {
        // Strip non-printable prefix
        const cleanFront = frontCandidate.replace(/^[^\x20-\x7E\u4E00-\u9FA5]+/, '');
        const cleanBack = backCandidate.replace(/^[^\x20-\x7E\u4E00-\u9FA5]+/, '');
        
        if (cleanFront.length > 4) {
          const { question, options } = extractChoiceOptions(cleanFront);
          const stage = detectDmaicStage(cleanFront + ' ' + cleanBack);

          cards.push({
            id: `fallback-${i}-${Date.now().toString(36)}`,
            front: question,
            back: cleanBack,
            options: options && options.length > 0 ? options : undefined,
            stage,
            tags: ['Anki自动提取', stage],
            cardType: options && options.length > 0 ? 'single_choice' : 'flashcard',
            interval: 0,
            repetitions: 0,
            easeFactor: 2.5,
            nextReviewDate: now,
            state: 'new',
          });
        }
      }
      if (cards.length >= 100) break; // Limit extracted fallback
    }

    if (cards.length > 0) {
      return {
        success: true,
        totalParsed: cards.length,
        cards,
        message: `通过智能流式提取成功解析 ${cards.length} 张 Anki 卡片！`
      };
    }

    throw new Error('未能从 Anki 二进制文件中解析出有效数据。建议在 Anki 电脑端选择“导出为纯文本文件(*.txt)”并上传。');
  } catch (err: any) {
    return {
      success: false,
      totalParsed: 0,
      cards: [],
      message: '解析 .apkg 失败: ' + (err.message || '文件格式不兼容'),
      error: String(err)
    };
  }
}
