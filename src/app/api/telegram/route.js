import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// --- CONFIGURATION ---
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_TOKEN = process.env.TELEGRAM_SECRET_TOKEN;

const PAGE_SIZE = 10; // Jumlah produk per halaman keypad

// --- HELPERS ---
async function sendMessage(chatId: number, text: string, options: any = {}) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...options }),
  });
}

async function editMessage(chatId: number, messageId: number, text: string, options: any = {}) {
  await fetch(`${TELEGRAM_API}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', ...options }),
  });
}

// Generate Catalog Box UI & Keyboard
function generateCatalogUI(products: any[], page: number, totalProducts: number) {
  const totalPages = Math.ceil(totalProducts / PAGE_SIZE);
  const startIdx = (page - 1) * PAGE_SIZE;
  const currentProducts = products.slice(startIdx, startIdx + PAGE_SIZE);

  // 1. Build Text Box
  let text = `<b>╭ - - - - - - - - - - - - - - - - - - - ╮</b>\n`;
  text += `<b>┊  LIST PRODUK</b>\n`;
  text += `<b>┊  page ${page} / ${totalPages}</b>\n`;
  text += `<b>┊- - - - - - - - - - - - - - - - - - - - - </b>\n`;

  if (currentProducts.length === 0) {
    text += `┊ (Kosong)\n`;
  } else {
    currentProducts.forEach((p, index) => {
        // Global Numbering: (page-1)*10 + 1 + localIndex
        const num = startIdx + index + 1;
        // Format: [1] PRODUCT NAME
        text += `┊ [${num}] ${p.name.toUpperCase()}\n`;
    });
  }
  text += `<b>╰ - - - - - - - - - - - - - - - - - - - ╯</b>\n\n`;
  text += `<i>Silakan tekan angka di bawah sesuai dengan nomor produk yang ingin Anda beli.</i>`;

  // 2. Build Keypad Buttons (Grid)
  // Logic: Tombol angka sesuai urutan yang tampil di halaman ini.
  // Jika page 1 tampil produk 1-10, tombolnya 1-10.
  // Jika page 2 tampil produk 11-20, tombolnya 11-20.
  
  const inline_keyboard = [];
  let row = [];

  for (let i = 0; i < currentProducts.length; i++) {
    const p = currentProducts[i];
    const num = startIdx + i + 1;
    
    // Callback: select_ID
    row.push({ text: `${num}`, callback_data: `select_${p.id}` });

    // New row every 5 buttons (Like the screenshot example width)
    if (row.length === 5) {
        inline_keyboard.push(row);
        row = [];
    }
  }
  if (row.length > 0) inline_keyboard.push(row);

  // 3. Navigation Buttons
  const navRow = [];
  if (page > 1) {
    navRow.push({ text: "⬅️ Prev", callback_data: `page_${page - 1}` });
  }
  // Add spacer or status?
  navRow.push({ text: `Page ${page}`, callback_data: 'noop' }); // Dummy button
  
  if (page < totalPages) {
    navRow.push({ text: "Next ➡️", callback_data: `page_${page + 1}` });
  }
  inline_keyboard.push(navRow);
  
  // Close Button
  inline_keyboard.push([{ text: "❌ Tutup Catalog", callback_data: 'close_catalog' }]);

  return { text, reply_markup: { inline_keyboard } };
}


// --- MAIN HANDLER ---
export async function POST(req: Request) {
  const tokenHeader = req.headers.get('x-telegram-bot-api-secret-token');
  if (tokenHeader !== SECRET_TOKEN) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const update = await req.json();

    // === HANDLE CALLBACK QUERY (TOMBOL) ===
    if (update.callback_query) {
      const query = update.callback_query;
      const chatId = query.message.chat.id;
      const messageId = query.message.message_id;
      const data = query.data;

      // > Handle Pagination
      if (data.startsWith('page_')) {
        const newPage = parseInt(data.split('_')[1]);
        const { data: allProducts, count } = await supabase.from('products').select('*', { count: 'exact' }).eq('is_active', true).order('created_at', { ascending: false }); // Urutkan biar konsisten
        
        if (allProducts) {
             const ui = generateCatalogUI(allProducts, newPage, count || 0);
             await editMessage(chatId, messageId, ui.text, ui.reply_markup);
        }
      }
      
      // > Handle Select Product (Detail View)
      else if (data.startsWith('select_')) {
        const productId = data.split('_')[1];
        const { data: product } = await supabase.from('products').select('*').eq('id', productId).single();

        if (product) {
            const detailText = `<b>📦 ${product.name}</b>\n\n` +
                               `📝 <b>Deskripsi:</b>\n${product.description || '-'}\n\n` +
                               `🏷 <b>Kategori:</b> ${product.software_type}\n` + 
                               `💰 <b>Harga:</b> Rp ${product.price.toLocaleString()} / ${product.unit}\n\n` +
                               `<i>Tekan tombol di bawah untuk membuat pesanan.</i>`;
            
            // Tombol Konfirmasi & Back
            const keyboard = {
                inline_keyboard: [
                    [{ text: "🛒 Checkout Sekarang", callback_data: `buy_${product.id}` }],
                    [{ text: "🔙 Kembali ke Catalog", callback_data: `page_1` }]
                ]
            };
            await editMessage(chatId, messageId, detailText, keyboard);
        }
      }

      // > Handle Buy (Create Order)
      else if (data.startsWith('buy_')) {
        const productId = data.split('_')[1];
        
        // Cek Product Info lagi untuk konfirmasi
        const { data: product } = await supabase.from('products').select('name, price').eq('id', productId).single();
        
        // Buat Order di Database
        const { data: newOrder, error } = await supabase.from('orders').insert({
          user_id: query.from.id,
          product_id: productId,
          status: 'pending',
          total_price: product.price 
        }).select().single();

        if (!error && newOrder) {
           // Kirim Payment Info
           const { data: settings } = await supabase.from('store_settings').select('*').eq('setting_key', 'payment_info').single();
           const payInfo = settings?.setting_value || "Silakan hubungi admin.";

           const successMsg = `✅ <b>Order #${newOrder.id} Berhasil Dibuat!</b>\n\n` + 
                              `Produk: <b>${product.name}</b>\n` +
                              `Total: <b>Rp ${product.price.toLocaleString()}</b>\n\n` +
                              `💳 <b>Panduan Pembayaran:</b>\n${payInfo}\n\n` +
                              `⚠️ <b>PENTING:</b>\nSetelah transfer, kirimkan FOTO BUKTI transfer di chat ini agar diproses otomatis.`;
           
           await sendMessage(chatId, successMsg);
           // Hapus menu sebelumnya agar bersih
           await fetch(`${TELEGRAM_API}/deleteMessage`, {
               method: 'POST',
               headers: {'Content-Type': 'application/json'},
               body: JSON.stringify({ chat_id: chatId, message_id: messageId })
           });

        } else {
           await sendMessage(chatId, `❌ Gagal membuat order. Silakan coba lagi nanti.`);
        }
      }

      else if (data === 'close_catalog') {
         await fetch(`${TELEGRAM_API}/deleteMessage`, {
             method: 'POST',
             headers: {'Content-Type': 'application/json'},
             body: JSON.stringify({ chat_id: chatId, message_id: messageId })
         });
      }

      // Answer Callback (Stop Loading Animation)
      await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ callback_query_id: query.id })
      });
      return NextResponse.json({ ok: true });
    }

    // === HANDLE TEXT MESSAGES ===
    if (!update.message) return NextResponse.json({ ok: true });

    const message = update.message;
    const chatId = message.chat.id;
    const text = message.text;
    const user = message.from;

    // Sync User
    await supabase.from('users').upsert({
      telegram_id: user.id,
      username: user.username,
      full_name: `${user.first_name} ${user.last_name || ''}`.trim()
    });

    if (text === '/start') {
       const { data: st } = await supabase.from('store_settings').select('*');
       const welcome = st?.find(s => s.setting_key === 'welcome_message')?.setting_value || "Welcome!";
       const storeName = st?.find(s => s.setting_key === 'store_name')?.setting_value || "Store";

       const msg = `👋 <b>Halo, selamat datang di ${storeName}!</b>\n\n${welcome}`;
       
       await sendMessage(chatId, msg, {
        reply_markup: {
          keyboard: [[{ text: "📦 Catalog Produk" }, { text: "🛒 Cek Pesanan" }]],
          resize_keyboard: true
        }
      });
    } 
    
    else if (text === '/products' || text === '📦 Catalog Produk') {
       // Fetch Page 1
       const { data: allProducts, count } = await supabase.from('products').select('*', { count: 'exact' }).eq('is_active', true).order('created_at', { ascending: false });

       if (!allProducts?.length) {
         await sendMessage(chatId, "⚠️ Produk sedang kosong saat ini.");
       } else {
         const ui = generateCatalogUI(allProducts, 1, count || 0);
         await sendMessage(chatId, ui.text, ui.reply_markup);
       }
    }

    else if (text === '🛒 Cek Pesanan') {
        const { data: orders } = await supabase
            .from('orders').select('*, products(name)')
            .eq('user_id', user.id).order('created_at', { ascending: false }).limit(5);

        if (!orders?.length) {
            await sendMessage(chatId, "📭 Belum ada riwayat pesanan.");
        } else {
            let report = "<b>🛒 5 Pesanan Terakhir Anda:</b>\n\n";
            orders.forEach((o: any) => {
                report += `🆔 <b>#${o.id}</b> - ${o.products?.name}\nStatus: <code>${o.status.toUpperCase()}</code>\n\n`;
            });
            await sendMessage(chatId, report);
        }
    }

    // Handle Image (Bukti Pembayaran)
    else if (message.photo) {
        const { data: pendingOrder } = await supabase
            .from('orders').select('*')
            .eq('user_id', user.id).eq('status', 'pending')
            .order('created_at', { ascending: false }).limit(1).single();

        if (pendingOrder) {
            const fileId = message.photo[message.photo.length - 1].file_id;
            const fileRes = await fetch(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
            const fileData = await fileRes.json();
            
            if (fileData.ok) {
                const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${fileData.result.file_path}`;
                await supabase.from('orders').update({
                    status: 'paid', // Mark as paid
                    payment_proof_url: fileUrl
                }).eq('id', pendingOrder.id);
                
                await sendMessage(chatId, `✅ <b>Bukti Diterima!</b>\nOrder #${pendingOrder.id} sedang diverifikasi oleh admin.`);
            }
        } else {
            await sendMessage(chatId, "⚠️ Anda tidak memiliki pesanan Pending. Silakan order dulu.");
        }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
  }
}