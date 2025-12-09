import { NextResponse } from 'next/server';
import TelegramBot from 'node-telegram-bot-api';
import { supabase } from '@/lib/supabase';

// ==================================================================
// 1. KONFIGURASI BOT & PAYMENT
// ==================================================================
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = token ? new TelegramBot(token, { polling: false }) : null;

// Info Rekening (Muncul saat Invoice)
const BANK_INFO = {
    bank: "BCA",
    number: "1234-5678-9000",
    name: "STORE OFFICIAL"
};

// Konfigurasi Grid Tombol (Pagination)
const MAX_BUTTONS_DISPLAY = 50;  // Batas Maksimal Produk di Tombol
const BUTTONS_PER_ROW = 6;       // 6 Angka per baris agar rapi

// Helper Format Rupiah
const formatRupiah = (num) => new Intl.NumberFormat('id-ID').format(num);

// ==================================================================
// 2. HELPER: MEMBUAT KEYBOARD DINAMIS
// ==================================================================
function createDynamicKeyboard(totalItems) {
    // A. Baris Menu Atas
    const topMenu = [
        { text: "🏷 List Produk" }, { text: "🛍 Voucher" }, { text: "📦 Laporan Stok" }
    ];

    // B. Baris Menu Bawah
    const bottomMenu = [
        { text: "💰 Deposit" }, { text: "❓ Cara" }, { text: "⚠️ Information" }
    ];

    // C. Baris Angka
    const numberGrid = [];
    const count = Math.min(totalItems, MAX_BUTTONS_DISPLAY);

    if (count > 0) {
        let tempRow = [];
        for (let i = 1; i <= count; i++) {
            tempRow.push({ text: `${i}` });
            if (tempRow.length === BUTTONS_PER_ROW) {
                numberGrid.push(tempRow);
                tempRow = [];
            }
        }
        if (tempRow.length > 0) {
            numberGrid.push(tempRow);
        }
    }

    return {
        keyboard: [ topMenu, ...numberGrid, bottomMenu ],
        resize_keyboard: true,
        is_persistent: true,
        input_field_placeholder: "Pilih menu atau nomor produk..."
    };
}


// ==================================================================
// 3. MAIN ROUTE HANDLER
// ==================================================================
export async function POST(req) {
    if (!bot) return NextResponse.json({ error: 'Bot inactive' });

    try {
        const body = await req.json();

        // 1. Callback Query (Klik tombol Varian/Checkout/Cancel)
        if (body.callback_query) {
            await handleCallbackQuery(body.callback_query);
        }
        // 2. Message Text (Menu / Angka)
        else if (body.message?.text) {
            await handleTextMessage(body.message);
        }
        // 3. Message Photo (Bukti Transfer)
        else if (body.message?.photo) {
            await handlePhotoMessage(body.message);
        }

        return NextResponse.json({ status: 'ok' });
    } catch (error) {
        console.error('SERVER ERROR MAIN:', error);
        return NextResponse.json({ error: error.message });
    }
}


// ==================================================================
// 4. LOGIC: CALLBACK QUERY (CHECKOUT, VARIAN, & BATAL)
// ==================================================================
async function handleCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // Hilangkan icon loading di tombol
    await bot.answerCallbackQuery(query.id);

    // --- TOMBOL BATAL ---
    if (data === 'cancel') {
        await bot.deleteMessage(chatId, messageId);
        return;
    }

    /* Logic Checkout: Normal & Varian */
    let productId = null;
    let variantIndex = -1; // -1 = produk normal

    if (data.startsWith('checkout_')) {
        productId = data.split('_')[1];
    } else if (data.startsWith('vcheckout_')) {
        const parts = data.split('_');
        productId = parts[1];
        variantIndex = parseInt(parts[2]);
    } else {
        return; 
    }

    // 1. Ambil Data Produk
    const { data: product } = await supabase
        .from('products')
        .select('*')
        .eq('id', productId)
        .single();

    if (!product) {
        return bot.sendMessage(chatId, "⚠️ Error: Produk tidak ditemukan di database.");
    }
/* ==============================================
   UPDATE LOGIC CHECKOUT (HANDLE CALLBACK)
============================================== */
// ... (Bagian atas function handleCallbackQuery sama, ganti bagian checkout logic ini:)

    /* ... kode snippet di dalam if (checkout/vcheckout) ... */

    // 2. Logic Penentuan Harga & Nama
    let finalPrice = 0;
    let finalVariantName = null;     
    let displayName = product.name;  
    
    // VARIABEL KHUSUS UNIT 
    // Default unitDisplay mengikuti unit produk (Misal: / pcs, / diamond)
    // Tapi jika VARIAN dipilih, unitDisplay dikosongkan (Kecuali anda mau tampil bulan)
    let unitDisplay = ""; 

    if (variantIndex > -1) {
        // --- KASUS: BELI VIA VARIAN ---
        const variants = (typeof product.variants === 'string') 
            ? JSON.parse(product.variants) 
            : product.variants;

        if (variants && variants[variantIndex]) {
            const selected = variants[variantIndex];
            finalPrice = selected.price;            
            finalVariantName = selected.name;       
            // Unit biasanya tidak dipakai di varian jika nama variannya sudah jelas ("1 Bulan")
            // atau bisa dikosongkan
            unitDisplay = ""; 
        } 
    } else {
        // --- KASUS: BELI NORMAL / SATUAN ---
        finalPrice = product.price;
        // Munculkan unit di sini
        unitDisplay = product.unit ? ` / ${product.unit}` : ''; 
    }

    // 3. Masukkan ke Database Orders (Sama seperti sebelumnya)
    const { data: order, error } = await supabase.from('orders').insert({
        user_id: chatId,
        product_id: productId,
        total_price: finalPrice,         
        variant_name: finalVariantName,  
        status: 'pending' 
    }).select().single();

    if (error) {
        return bot.sendMessage(chatId, "❌ Database Error.");
    }

    // 4. Kirim Invoice Final
    const invoiceMsg = `
⚡️ <b>TAGIHAN PEMBAYARAN (#${order.id})</b>
────────────────────
📦 <b>Item:</b> ${product.name.toUpperCase()}
🔖 <b>Varian:</b> ${finalVariantName || '-'}
💰 <b>Total Invoice:</b> Rp ${formatRupiah(finalPrice)}${unitDisplay}
────────────────────

🏦 <b>REKENING PUTRA:</b>
<b>${BANK_INFO.bank}</b>
<code>${BANK_INFO.number}</code>
A.N ${BANK_INFO.name}

📸 <b>LANGKAH SEJARAH:</b>
Status pesanan: <b>🟡 PENDING</b>.
Mohon segera <b>kirim FOTO BUKTI TRANSFER</b> sekarang juga di chat ini.
`;

// ... (lanjut ke editMessageText)

    // Edit pesan
    await bot.editMessageText(invoiceMsg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML'
    });
}


// ==================================================================
// 5. LOGIC: TEXT MESSAGE (NAVIGASI & UPSERT USER FIX)
// ==================================================================
async function handleTextMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;
    const user = msg.from;
    const full_name = `${user.first_name || ''} ${user.last_name || ''}`.trim();

    /* 
       FIX: Menghilangkan .catch() pada syntax Supabase.
       Gunakan destructuring { error } untuk menangkap error.
    */
    const { error: upsertError } = await supabase.from('users').upsert({
        telegram_id: chatId,
        username: user.username,
        full_name: full_name
    });

    if (upsertError) {
        // Cukup log di console server, jangan diproses lebih lanjut agar bot tetap jalan
        console.error('Upsert user failed:', upsertError); 
    }

    // Hitung Stok untuk Keyboard
    const { count } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

    const totalActive = count || 0;
    const dynamicKeyboard = createDynamicKeyboard(totalActive);

    // C. Jika Text Adalah ANGKA (1, 2, 3...)
    if (/^\d+$/.test(text) && text.length < 4) { 
        await showProductDetail(chatId, parseInt(text), dynamicKeyboard);
        return; 
    }

    // D. Router Menu
    switch (text) {
        case '/start':
            await bot.sendPhoto(
                chatId,
                "https://files.catbox.moe/22832e.jpg", // GANTI SESUAI GAMBAR ANDA
                {
                    caption: `👋 <b>Halo, ${user.first_name}!</b>\nSelamat datang di Store Bot.\n\nSilakan pilih menu <b>List Produk</b> di bawah.`,
                    parse_mode: 'HTML',
                    reply_markup: dynamicKeyboard
                }
            );
            break;

        case '🏷 List Produk':
            await sendProductList(chatId, dynamicKeyboard);
            break;

        case '🛍 Voucher':
            await bot.sendMessage(chatId, "🔐 Voucher belum tersedia.", { reply_markup: dynamicKeyboard });
            break;

        case '📦 Laporan Stok':
            await bot.sendMessage(chatId, `📊 <b>Info Stok</b>\n\nProduk Aktif: <b>${totalActive} Item</b>`, { parse_mode: 'HTML', reply_markup: dynamicKeyboard });
            break;

        case '💰 Deposit':
            await bot.sendMessage(chatId, "Hubungi admin untuk deposit.", { reply_markup: dynamicKeyboard });
            break;

        case '❓ Cara':
            const tutorial = `
📚 <b>CARA BELI:</b>
1. Klik menu <b>List Produk</b>.
2. Ingat nomor produk yang diinginkan (cth: 1).
3. Klik angka <b>1</b> di tombol keyboard.
4. Pilih Varian & Transfer.
            `;
            await bot.sendMessage(chatId, tutorial, { parse_mode: 'HTML', reply_markup: dynamicKeyboard });
            break;

        case '⚠️ Information':
            await bot.sendMessage(chatId, "Bot Status: Online.", { reply_markup: dynamicKeyboard });
            break;

        default:
            await bot.sendMessage(chatId, "Silakan pilih menu.", { reply_markup: dynamicKeyboard });
            break;
    }
}


// ===================================
// UPDATE FUNCTION (LIST PRODUK)
// ===================================
async function sendProductList(chatId, kb) {
  const { data: products } = await supabase
      .from('products')
      .select('*')
      .eq('is_active', true)
      .order('id', { ascending: true }) // Pastikan urut ID
      .limit(MAX_BUTTONS_DISPLAY);

  if (!products || products.length === 0) {
      return bot.sendMessage(chatId, "⚠️ Produk Kosong.", { reply_markup: kb });
  }

  let message = `🛒 <b>DAFTAR HARGA UPDATE</b>\n`;
  message += `<i>Klik nomor tombol sesuai produk.</i>\n\n`;

  products.forEach((p, idx) => {
      const num = idx + 1;
      
      // Cek Varian (Safe Parse)
      let variants = [];
      try { if(p.variants) variants = typeof p.variants === 'string' ? JSON.parse(p.variants) : p.variants; } catch(e){}
      const hasVariants = Array.isArray(variants) && variants.length > 0;

      // FORMAT DISPLAY HARGA:
      // Jika Normal: "Rp 10.000 / akun"
      // Jika Varian: "Mulai Rp 10.000 (Ada opsi lain)"
      // TAPI: User meminta agar harga asli TAMPIL. 
      // Jadi logicnya: Priority Harga asli dulu.
      
      const price = formatRupiah(p.price);
      const unitLabel = p.unit ? ` / ${p.unit}` : ''; 
      let priceText = `Rp ${price}${unitLabel}`; // Format Default (Asli/Tabel)

      if (hasVariants) {
          const minPrice = Math.min(...variants.map(v => v.price));
          // Tambahkan hint jika ada varian
          priceText += `\n   ↳ <i>Mulai: Rp ${formatRupiah(minPrice)}</i>`;
      }

      message += `[${num}] <b>${p.name.toUpperCase()}</b>\n`;
      message += `   💰 ${priceText}\n\n`;
  });

  await bot.sendMessage(chatId, message, { parse_mode: 'HTML', reply_markup: kb });
}

// ===================================
// UPDATE FUNCTION (DETAIL LINK)
// ===================================
async function showProductDetail(chatId, selectedNumber, kb) {
  // Logic fetch sama persis dengan List agar index sinkron
  const { data: products } = await supabase
      .from('products')
      .select('*')
      .eq('is_active', true)
      .order('id', { ascending: true })
      .limit(MAX_BUTTONS_DISPLAY);
  
  const index = selectedNumber - 1;

  if (!products || !products[index]) {
      return bot.sendMessage(chatId, `⚠️ Produk nomor ${selectedNumber} tidak valid. Refresh List.`, { reply_markup: kb });
  }

  const item = products[index];

  // 1. Ambil Harga & Unit "ASLI" (Dari tabel Products)
  // Tampilkan ini apapun kondisinya (Normal / Varian)
  const basePrice = formatRupiah(item.price);
  const baseUnit = item.unit ? ` / ${item.unit}` : ''; 
  const fullPriceLabel = `Rp ${basePrice}${baseUnit}`;

  // 2. Siapkan Detail Text Dasar
  let detailText = `
🛍 <b>DETAIL PRODUK</b>
➖➖➖➖➖➖➖➖➖➖➖
📦 <b>${item.name.toUpperCase()}</b>
💰 <b>ASLI:</b> ${fullPriceLabel}
➖➖➖➖➖➖➖➖➖➖➖
📝 <b>Deskripsi:</b>
${item.description || "Tidak ada deskripsi tambahan."}
`;

  // 3. Cek Varian
  let variants = [];
  try { if(item.variants) variants = typeof item.variants === 'string' ? JSON.parse(item.variants) : item.variants; } catch(e){}
  const hasVariants = Array.isArray(variants) && variants.length > 0;

  let inlineKeyboard = [];

  // --- KONDISI A: ADA VARIAN ---
  if (hasVariants) {
      detailText += `\n\n👇 <b>SILAKAN PILIH PAKET UTAMA:</b>`;
      
      // Loop tombol varian
      variants.forEach((v, idx) => {
          const vName = v.name || 'Paket';
          const vPrice = v.price ? formatRupiah(v.price) : '0';
          inlineKeyboard.push([
              { 
                  text: `🔹 ${vName} - Rp ${vPrice}`, 
                  callback_data: `vcheckout_${item.id}_${idx}`
              }
          ]);
      });
  } 
  // --- KONDISI B: PENGGUNAAN NORMAL / SINGLE ---
  else {
      detailText += `\n\n👇 <i>Tekan tombol di bawah untuk proses beli:</i>`;
      
      inlineKeyboard.push([
          { text: `✅ Beli (${fullPriceLabel})`, callback_data: `checkout_${item.id}` }
      ]);
  }

  // Tombol Batal Selalu Muncul
  inlineKeyboard.push([ { text: "✖️ Tutup / Batal", callback_data: `cancel` } ]);

  await bot.sendMessage(chatId, detailText, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: inlineKeyboard }
  });
}

  // Tombol Batal
  inlineKeyboard.push([ { text: "✖️ Batal", callback_data: `cancel` } ]);

  await bot.sendMessage(chatId, detailText, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: inlineKeyboard }
  });


// ==================================================================
// 7. PHOTO HANDLER: UPLOAD KE CATBOX 
// ==================================================================
async function handlePhotoMessage(msg) {
    const chatId = msg.chat.id;

    // Ambil order "Pending" terakhir
    // Perhatikan: status 'pending' (Case sensitive sesuai database anda)
    const { data: order } = await supabase
        .from('orders')
        .select('*, products(name)')
        .eq('user_id', chatId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (!order) {
        return bot.sendMessage(chatId, "⚠️ <b>Tidak ada tagihan pending!</b>\nSilakan order/checkout produk dulu sebelum kirim bukti transfer.", {parse_mode:'HTML'});
    }

    const loadingMsg = await bot.sendMessage(chatId, "⏳ <i>Mengupload bukti...</i>", {parse_mode:'HTML'});

    try {
        const photo = msg.photo[msg.photo.length - 1]; 
        const telegramFileLink = await bot.getFileLink(photo.file_id);
        
        const response = await fetch(telegramFileLink);
        const arrayBuffer = await response.arrayBuffer();
        const imageBlob = new Blob([arrayBuffer], { type: 'image/jpeg' });

        const formData = new FormData();
        formData.append('reqtype', 'fileupload');
        formData.append('fileToUpload', imageBlob, `struk_${order.id}.jpg`);

        const catboxReq = await fetch('https://catbox.moe/user/api.php', {
            method: 'POST',
            body: formData
        });

        if (!catboxReq.ok) throw new Error("Catbox server error");
        const catboxUrl = await catboxReq.text(); 
        if (!catboxUrl.startsWith("http")) throw new Error("Gagal upload gambar");

        // Update DB
        const { error: errorUpdate } = await supabase.from('orders').update({
            status: 'verification',
            payment_proof_url: catboxUrl
        }).eq('id', order.id);

        if(errorUpdate) throw errorUpdate;

        await bot.deleteMessage(chatId, loadingMsg.message_id);

        // Info
        const vInfo = order.variant_name ? `(${order.variant_name})` : '';

        const successText = `
✅ <b>BUKTI DITERIMA!</b>
──────────────
<b>Order ID:</b> #${order.id}
<b>Produk:</b> ${order.products?.name} ${vInfo}
<b>Status:</b> 🔵 VERIFICATION

Mohon tunggu admin memverifikasi. 
Produk akan dikirim otomatis ke sini setelah status 'completed'.
`;
        await bot.sendMessage(chatId, successText, { parse_mode: 'HTML' });

    } catch (e) {
        console.error("Upload Error:", e);
        await bot.deleteMessage(chatId, loadingMsg.message_id);
        await bot.sendMessage(chatId, "⚠️ Gagal upload. Mohon kirim ulang fotonya.");
    }
}