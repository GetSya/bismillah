import { NextResponse } from 'next/server';
import TelegramBot from 'node-telegram-bot-api';
import { supabase } from '@/lib/supabase';

// ==================================================================
// 1. KONFIGURASI BOT
// ==================================================================
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = token ? new TelegramBot(token, { polling: false }) : null;

// Info Rekening
const BANK_INFO = {
    bank: "BCA",
    number: "1234-5678-9000",
    name: "STORE OFFICIAL"
};

// Config Tampilan
const MAX_BUTTONS_DISPLAY = 40; 
const BUTTONS_PER_ROW = 6;


// ==================================================================
// 2. KEYBOARD DINAMIS (Tetap Sama)
// ==================================================================
function createDynamicKeyboard(totalItems) {
    const topMenu = [
        { text: "🏷 List Produk" }, { text: "🛍 Voucher" }, { text: "📦 Laporan Stok" }
    ];
    const bottomMenu = [
        { text: "💰 Deposit" }, { text: "❓ Cara" }, { text: "⚠️ Information" }
    ];

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
        if (tempRow.length > 0) numberGrid.push(tempRow);
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

        // A. HANDLE KLIK TOMBOL INLINE (Checkout / Cancel)
        if (body.callback_query) {
            await handleCallbackQuery(body.callback_query);
        }
        // B. HANDLE PESAN TEXT (Menu / Angka)
        else if (body.message?.text) {
            await handleTextMessage(body.message);
        }
        // C. HANDLE FOTO (Bukti TF)
        else if (body.message?.photo) {
            await handlePhotoMessage(body.message);
        }

        return NextResponse.json({ status: 'ok' });
    } catch (error) {
        console.error('Error:', error);
        return NextResponse.json({ error: error.message });
    }
}


// ==================================================================
// 4. LOGIC: CALLBACK (Tombol Checkout/Batal) - BAGIAN BARU ⚡️
// ==================================================================
async function handleCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data; // format: 'checkout_123' atau 'cancel'

    // Matikan loading di tombol user
    await bot.answerCallbackQuery(query.id);

    // 1. Handle tombol CANCEL / HOME
    if (data === 'cancel') {
        // Hapus pesan detail produk agar bersih
        await bot.deleteMessage(chatId, messageId);
        // (Opsional) Kirim pesan batal
        // await bot.sendMessage(chatId, "❌ Pesanan dibatalkan."); 
    }

    // 2. Handle tombol CHECKOUT LANGSUNG
    else if (data.startsWith('checkout_')) {
        const productId = data.split('_')[1];

        // Ambil data produk real-time
        const { data: product } = await supabase
            .from('products')
            .select('*')
            .eq('id', productId)
            .single();

        if (!product) {
            return bot.sendMessage(chatId, "⚠️ Produk tidak ditemukan atau sudah dihapus.");
        }

        // CREATE ORDER (Insert ke DB sekarang)
        const { data: order, error } = await supabase.from('orders').insert({
            user_id: chatId,
            product_id: productId,
            total_price: product.price,
            status: 'pending'
        }).select().single();

        if (error) {
            console.error(error);
            return bot.sendMessage(chatId, "⚠️ Gagal membuat order sistem.");
        }

        // Generate Pesan Invoice
        const price = new Intl.NumberFormat('id-ID').format(product.price);
        const invoiceMsg = `
✅ <b>ORDER DIBUAT! (#${order.id})</b>
────────────────────
📦 <b>${product.name}</b>
💰 <b>Rp ${price}</b>
────────────────────

💳 <b>INFO PEMBAYARAN:</b>
Bank: <b>${BANK_INFO.bank}</b>
No. Rek: <code>${BANK_INFO.number}</code>
A.N: ${BANK_INFO.name}

📸 <b>LANGKAH TERAKHIR:</b>
Silakan kirim foto/screenshot bukti transfer di sini.
        `;

        // Update Pesan Detail tadi menjadi Invoice (Supaya rapi)
        // Kita juga hapus tombol checkout agar tidak diklik 2x
        await bot.editMessageText(invoiceMsg, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML'
        });
    }
}


// ==================================================================
// 5. LOGIC: TEXT MESSAGE
// ==================================================================
async function handleTextMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;
    const user = msg.from;

    // Save User
    await supabase.from('users').upsert({
        telegram_id: chatId,
        username: user.username,
        full_name: `${user.first_name}`.trim()
    });

    // Helper: Hitung Keyboard
    const { count } = await supabase.from('products').select('*', { count: 'exact', head: true }).eq('is_active', true);
    const keyboardMarkup = createDynamicKeyboard(count || 0);

    // LOGIC: Jika user mengetik Angka (Milih Produk)
    if (/^\d+$/.test(text)) {
        await showProductDetail(chatId, parseInt(text));
        return; 
    }

    // LOGIC: Menu Utama
    switch (text) {
        case '/start':
            await bot.sendMessage(chatId, `👋 <b>Halo, ${user.first_name}!</b>\nSelamat Datang. Klik menu <b>List Produk</b> untuk melihat katalog.`, { parse_mode: 'HTML', reply_markup: keyboardMarkup });
            break;

        case '🏷 List Produk':
            await sendProductList(chatId, keyboardMarkup);
            break;

        case '🛍 Voucher':
            await bot.sendMessage(chatId, "🚫 Fitur belum tersedia.", { reply_markup: keyboardMarkup });
            break;

        case '📦 Laporan Stok':
            await bot.sendMessage(chatId, `📊 Total Produk Ready: <b>${count} Item</b>.`, { parse_mode: 'HTML', reply_markup: keyboardMarkup });
            break;
        
        // Handle menu lainnya (Deposit, Cara, Info) sesuai selera..
        default:
            // Jangan reply error jika text tidak dikenali, biarkan silent atau tampilkan help
             await bot.sendMessage(chatId, "Silakan pilih menu menggunakan tombol.", { reply_markup: keyboardMarkup });
    }
}


// ==================================================================
// 6. HELPER: SHOW LIST & SHOW DETAIL
// ==================================================================

// TAMPILKAN DAFTAR (Teks List)
async function sendProductList(chatId, replyMarkup) {
    const { data: products } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('price', { ascending: true }) // Sortir Harga (Konsisten)
        .limit(MAX_BUTTONS_DISPLAY);

    if (!products.length) return bot.sendMessage(chatId, "⚠️ Produk Kosong.");

    let msg = `🛒 <b>DAFTAR HARGA UPDATE</b>\n\n`;
    products.forEach((p, idx) => {
        msg += `[${idx + 1}] <b>${p.name.toUpperCase()}</b>\n   Rp ${new Intl.NumberFormat('id-ID').format(p.price)}\n`;
    });
    msg += `\n👇 <i>Tekan tombol angka di bawah untuk melihat detail.</i>`;

    await bot.sendMessage(chatId, msg, { parse_mode: 'HTML', reply_markup: replyMarkup });
}

// TAMPILKAN DETAIL (Penting: INI UPDATE UTAMANYA)
async function showProductDetail(chatId, selectedNumber) {
    // 1. Ambil data (Logika Index sama persis dg sendProductList)
    const { data: products } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('price', { ascending: true })
        .limit(MAX_BUTTONS_DISPLAY);

    const index = selectedNumber - 1;

    // Validasi
    if (!products || !products[index]) {
        return bot.sendMessage(chatId, `⚠️ Produk nomor ${selectedNumber} tidak ditemukan. Silakan refresh list.`);
    }

    const item = products[index];
    const price = new Intl.NumberFormat('id-ID').format(item.price);
    
    // Pesan Detail
    const detailMsg = `
🛍 <b>DETAIL PRODUK</b>
➖➖➖➖➖➖➖➖➖➖
🏷 <b>Nama:</b> ${item.name}
💰 <b>Harga:</b> Rp ${price}
📄 <b>Deskripsi:</b>
${item.description || "<i>Tidak ada keterangan tambahan.</i>"}
➖➖➖➖➖➖➖➖➖➖

<i>Apakah Anda ingin melanjutkan pembelian?</i>
`;

    // Tombol INLINE (Muncul di bawah chat detail)
    const actionButtons = {
        inline_keyboard: [
            [
                { text: "✅ Checkout Langsung", callback_data: `checkout_${item.id}` }
            ],
            [
                { text: "🏠 Kembali / Batal", callback_data: `cancel` } 
            ]
        ]
    };

    // Kirim pesan Detail
    await bot.sendMessage(chatId, detailMsg, {
        parse_mode: 'HTML',
        reply_markup: actionButtons 
    });
}


// ==================================================================
// 7. HANDLE FOTO (Upload) - Tidak Ada Perubahan dari Kode Fix sebelumnya
// ==================================================================
async function handlePhotoMessage(msg) {
    const chatId = msg.chat.id;
    // Cari Pending Order
    const { data: order } = await supabase
        .from('orders')
        .select('*, products(name)')
        .eq('user_id', chatId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (!order) return bot.sendMessage(chatId, "❌ Belum ada order pending. Silakan checkout dulu.");

    const loadMsg = await bot.sendMessage(chatId, "⏳ Uploading...");

    try {
        const photo = msg.photo[msg.photo.length - 1];
        const fileUrl = await bot.getFileLink(photo.file_id);
        const buffer = Buffer.from(await (await fetch(fileUrl)).arrayBuffer());
        
        const filename = `proof_${order.id}_${Date.now()}.jpg`;
        const bucket = 'payment-proofs'; // Sesuai bucket kamu

        const { error } = await supabase.storage.from(bucket).upload(filename, buffer, { contentType: 'image/jpeg', upsert: true });
        if(error) throw error;

        const { data } = supabase.storage.from(bucket).getPublicUrl(filename);

        await supabase.from('orders').update({
            status: 'verification',
            payment_proof_url: data.publicUrl
        }).eq('id', order.id);

        await bot.deleteMessage(chatId, loadMsg.message_id);
        await bot.sendMessage(chatId, `✅ <b>SUKSES!</b>\nOrder #${order.id} sedang diverifikasi admin.`);

    } catch (e) {
        bot.deleteMessage(chatId, loadMsg.message_id);
        bot.sendMessage(chatId, "⚠️ Gagal upload.");
    }
}