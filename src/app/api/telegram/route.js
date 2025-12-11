import { NextResponse } from 'next/server';
import TelegramBot from 'node-telegram-bot-api';
import { createClient } from '@supabase/supabase-js';

// ==================================================================
// 1. CONFIGURATION
// ==================================================================
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = token ? new TelegramBot(token, { polling: false }) : null;

// ID ADMIN TETAP (@sofunsyabi)
const ADMIN_ID = '662362624'; 

const BANK_INFO = {
    bank: "BCA",
    number: "1234-5678-9000",
    name: "STORE OFFICIAL"
};

const MAX_BUTTONS_DISPLAY = 50;
const BUTTONS_PER_ROW = 6;

// Helper Format Rupiah
const formatRupiah = (num: number) => new Intl.NumberFormat('id-ID').format(num);

// ==================================================================
// 2. HELPER KEYBOARD
// ==================================================================
function createDynamicKeyboard(totalItems: number) {
    const topMenu = [{ text: "🏷 List Produk" }, { text: "🛍 Voucher" }];
    const midMenu = [{ text: "📦 Laporan Stok" }, { text: "❓ Cara" }];
    const bottomMenu = [{ text: "⚠️ Information" }];

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
        keyboard: [topMenu, midMenu, ...numberGrid, bottomMenu],
        resize_keyboard: true,
        is_persistent: true,
        input_field_placeholder: "Pilih menu..."
    };
}

// ==================================================================
// 3. MAIN ROUTE HANDLER
// ==================================================================
export async function POST(req: Request) {
    if (!bot) return NextResponse.json({ error: 'Bot inactive' });

    try {
        const update = await req.json();

        if (update.callback_query) {
            await handleCallbackQuery(update.callback_query);
        } 
        else if (update.message?.text) {
            await handleTextMessage(update.message);
        } 
        else if (update.message?.photo) {
            await handlePhotoMessage(update.message);
        }

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error('Server Error:', error);
        return NextResponse.json({ ok: true });
    }
}

// ==================================================================
// 4. LOGIC HANDLERS
// ==================================================================

// --- A. CALLBACK QUERY (Tombol Klik) ---
async function handleCallbackQuery(query: any) {
    if(!bot) return;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    await bot.answerCallbackQuery(query.id).catch(()=>{});

    if (data === 'cancel') {
        await bot.deleteMessage(chatId, messageId).catch(()=>{});
        return;
    }

    let productId = null;
    let variantIndex = -1;

    if (data.startsWith('checkout_')) {
        productId = data.split('_')[1];
    } else if (data.startsWith('vcheckout_')) {
        const parts = data.split('_');
        productId = parts[1];
        variantIndex = parseInt(parts[2]);
    } else {
        return;
    }

    // 1. Get Product
    const { data: product } = await supabase.from('products').select('*').eq('id', productId).single();
    if (!product) return bot.sendMessage(chatId, "⚠️ Produk tidak ditemukan.");

    // 2. Calculate Price
    let finalPrice = product.price;
    let finalVariantName = null;
    
    if (variantIndex > -1) {
        const variants = typeof product.variants === 'string' ? JSON.parse(product.variants) : product.variants;
        if (variants && variants[variantIndex]) {
            finalPrice = variants[variantIndex].price;
            finalVariantName = variants[variantIndex].name;
        }
    }

    // 3. Create Order
    const { data: order, error } = await supabase.from('orders').insert({
        user_id: chatId,
        product_id: productId,
        total_price: finalPrice,
        variant_name: finalVariantName,
        status: 'pending'
    }).select().single();

    if (error) return bot.sendMessage(chatId, "❌ Gagal membuat invoice.");

    // 4. Send Invoice
    const invoiceMsg = `
⚡️ <b>TAGIHAN PEMBAYARAN (#${order.id})</b>
────────────────────
📦 <b>Item:</b> ${product.name}
🔖 <b>Varian:</b> ${finalVariantName || '-'}
💰 <b>Total:</b> Rp ${formatRupiah(finalPrice)}
────────────────────

🏦 <b>TRANSFER KE:</b>
<b>${BANK_INFO.bank}</b>
<code>${BANK_INFO.number}</code>
A.N ${BANK_INFO.name}

📸 <b>INSTRUKSI:</b>
Silakan transfer lalu <b>kirim FOTO BUKTI TRANSFER</b> di chat ini.
    `;

    await bot.editMessageText(invoiceMsg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML'
    });
}

// --- B. TEXT MESSAGE ---
async function handleTextMessage(msg: any) {
    if(!bot) return;
    const chatId = msg.chat.id;
    const text = msg.text;
    const user = msg.from;

    // --- LOGIC ADMIN REPLY ---
    // Jika @sofunsyabi (662362624) me-reply pesan
    if (String(chatId) === ADMIN_ID) {
        if (msg.reply_to_message && msg.reply_to_message.from.is_bot) {
            await handleAdminReply(msg);
        } else if (text === '/start') {
            await bot.sendMessage(chatId, "👮‍♂️ <b>Admin Mode</b>\nReply pesan user untuk membalas.", {parse_mode:'HTML'});
        }
        return; 
    }

    // --- LOGIC USER BIASA ---
    await supabase.from('users').upsert({
        telegram_id: chatId,
        username: user.username,
        full_name: `${user.first_name || ''} ${user.last_name || ''}`.trim()
    });

    const { count } = await supabase.from('products').select('*', { count: 'exact', head: true }).eq('is_active', true);
    const kb = createDynamicKeyboard(count || 0);

    // Seleksi Nomor Produk
    if (/^\d+$/.test(text) && text.length < 4) {
        await showProductDetail(chatId, parseInt(text), kb);
        return;
    }

    switch (text) {
        case '/start':
            await bot.sendMessage(chatId, `👋 <b>Halo, ${user.first_name}!</b>\nSelamat datang di Store Bot.`, { parse_mode: 'HTML', reply_markup: kb });
            break;

        case '🏷 List Produk':
            await sendProductList(chatId, kb);
            break;

        case '❓ Cara':
            await bot.sendMessage(chatId, "📚 <b>Cara Order:</b>\n1. Pilih List Produk\n2. Ketik Angka\n3. Transfer & Kirim Bukti", { parse_mode: 'HTML', reply_markup: kb });
            break;
            
        case '📦 Laporan Stok':
             await bot.sendMessage(chatId, `📦 Produk Aktif: <b>${count}</b> Item`, { parse_mode: 'HTML', reply_markup: kb });
             break;

        default:
            // Input Text Biasa -> Masuk Live Chat ke Admin
            await handleUserChatToAdmin(chatId, user, text);
            break;
    }
}

// --- C. PHOTO HANDLER (Bukti Transfer) ---
async function handlePhotoMessage(msg: any) {
    if(!bot) return;
    const chatId = msg.chat.id;
    
    // Cari Order Pending Terakhir
    const { data: order } = await supabase
        .from('orders')
        .select('*, products(name)')
        .eq('user_id', chatId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (!order) {
        return bot.sendMessage(chatId, "⚠️ Anda tidak memiliki tagihan Pending. Order dulu ya.");
    }

    const waitMsg = await bot.sendMessage(chatId, "⏳ Upload bukti...");

    try {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const fileLink = await bot.getFileLink(fileId);
        
        const res = await fetch(fileLink);
        const blob = await res.blob();

        const formData = new FormData();
        formData.append('reqtype', 'fileupload');
        formData.append('fileToUpload', blob, `proof_${order.id}.jpg`);

        const catboxRes = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: formData });
        if (!catboxRes.ok) throw new Error("Catbox Failed");
        const proofUrl = await catboxRes.text();

        // Update DB
        await supabase.from('orders').update({
            status: 'verification',
            payment_proof_url: proofUrl
        }).eq('id', order.id);

        await bot.deleteMessage(chatId, waitMsg.message_id).catch(()=>{});
        await bot.sendMessage(chatId, `✅ <b>Bukti Diterima!</b>\nMohon tunggu verifikasi admin.`, { parse_mode: 'HTML' });

        // NOTIF KE ADMIN @sofunsyabi
        const adminMsg = `
🔔 <b>BUKTI TRANSFER BARU</b>
User: <code>${chatId}</code>
Order: #${order.id}
Item: ${order.products?.name}
URL: ${proofUrl}
`;
        await bot.sendMessage(ADMIN_ID, adminMsg, { parse_mode: 'HTML' });

    } catch (e) {
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(()=>{});
        await bot.sendMessage(chatId, "❌ Gagal upload bukti. Coba lagi.");
    }
}

// ==================================================================
// 5. HELPER FUNCTIONS (List Produk, Detail, Chat)
// ==================================================================

async function sendProductList(chatId: number | string, kb: any) {
    if(!bot) return;
    const { data: products } = await supabase.from('products').select('*').eq('is_active', true).order('id', { ascending: true }).limit(MAX_BUTTONS_DISPLAY);
    
    if (!products || products.length === 0) return bot.sendMessage(chatId, "⚠️ Produk Kosong.", { reply_markup: kb });

    let msg = `🛒 <b>LIST PRODUK</b>\n\n`;
    products.forEach((p, idx) => {
        msg += `<b>${idx + 1}. ${p.name}</b> - Rp ${formatRupiah(p.price)}\n`;
    });
    msg += `\n<i>Ketik nomor untuk membeli.</i>`;
    await bot.sendMessage(chatId, msg, { parse_mode: 'HTML', reply_markup: kb });
}

async function showProductDetail(chatId: number | string, num: number, kb: any) {
    if(!bot) return;
    const { data: products } = await supabase.from('products').select('*').eq('is_active', true).order('id', { ascending: true }).limit(MAX_BUTTONS_DISPLAY);
    
    const item = products?.[num - 1];
    if (!item) return bot.sendMessage(chatId, "⚠️ Produk tidak ditemukan.", { reply_markup: kb });

    let variants = [];
    try { variants = typeof item.variants === 'string' ? JSON.parse(item.variants) : item.variants; } catch(e) {}

    let text = `🛍 <b>${item.name.toUpperCase()}</b>\n\n${item.description || '-'}\n\n`;
    const buttons = [];

    if (Array.isArray(variants) && variants.length > 0) {
        text += `👇 <b>Pilih Paket:</b>`;
        variants.forEach((v: any, idx: number) => {
            buttons.push([{ text: `📦 ${v.name} - Rp ${formatRupiah(v.price)}`, callback_data: `vcheckout_${item.id}_${idx}` }]);
        });
    } else {
        text += `💰 Harga: <b>Rp ${formatRupiah(item.price)}</b>`;
        buttons.push([{ text: "✅ Beli Sekarang", callback_data: `checkout_${item.id}` }]);
    }
    buttons.push([{ text: "❌ Batal", callback_data: "cancel" }]);

    if(item.image_url) await bot.sendPhoto(chatId, item.image_url, { caption: text, parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } });
    else await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } });
}

// --- LIVE CHAT HELPERS ---

async function handleUserChatToAdmin(chatId: number, user: any, text: string) {
    if(!bot) return;

    // 1. Cek / Buat Room
    let { data: room } = await supabase.from('chat_rooms').select('id').eq('user_id', chatId).single();
    
    if (!room) {
        const { data: newRoom, error } = await supabase.from('chat_rooms').insert({ user_id: chatId }).select('id').single();
        if(error) return; 
        room = newRoom;
    } else {
        await supabase.from('chat_rooms').update({ updated_at: new Date().toISOString() }).eq('id', room.id);
    }

    // 2. Simpan Pesan User
    await supabase.from('chat_messages').insert({
        room_id: room.id,
        is_admin: false,
        content: text
    });

    // 3. Notif ke @sofunsyabi
    const adminMsg = `
📩 <b>PESAN DARI USER</b>
👤 <b>Nama:</b> ${user.first_name} (@${user.username || '-'})
🆔 <b>ID:</b> <code>${chatId}</code>
➖➖➖➖➖➖➖➖
${text}
`;
    await bot.sendMessage(ADMIN_ID, adminMsg, { parse_mode: 'HTML' });
}

async function handleAdminReply(msg: any) {
    if(!bot) return;
    const adminText = msg.text;
    const originalText = msg.reply_to_message?.text || "";

    // Ambil ID dari teks pesan yang di-reply
    const match = originalText.match(/ID:\s*(\d+)/);
    if (!match || !match[1]) return bot.sendMessage(ADMIN_ID, "⚠️ Gagal Reply. Format pesan user tidak valid.");

    const targetUserId = match[1];

    // Cek Room
    const { data: room } = await supabase.from('chat_rooms').select('id').eq('user_id', targetUserId).single();
    if (!room) return bot.sendMessage(ADMIN_ID, "⚠️ Room chat user tidak ditemukan.");

    // Kirim Balasan ke User
    try {
        await bot.sendMessage(targetUserId, `👤 <b>ADMIN:</b>\n${adminText}`, { parse_mode: 'HTML' });
        
        // Simpan Pesan Admin
        await supabase.from('chat_messages').insert({
            room_id: room.id,
            is_admin: true,
            content: adminText,
            is_read: true
        });

        await bot.sendMessage(ADMIN_ID, `✅ Terkirim ke ${targetUserId}`);
    } catch (e) {
        await bot.sendMessage(ADMIN_ID, `❌ Gagal kirim. User mungkin memblokir bot.`);
    }
}
