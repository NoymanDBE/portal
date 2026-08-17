package com.dror.portal

import android.content.Context
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object FeedStore {
    private const val PREFS = "portal_prefs"

    data class Snapshot(
        val newsLine: String,
        val stocksLine: String,
        val dealsLine: String,
        val updated: String,
    )

    fun baseUrl(context: Context): String? =
        context.getSharedPreferences(PREFS, 0).getString("feed_base", null)?.trimEnd('/')

    fun setBaseUrl(context: Context, url: String) =
        context.getSharedPreferences(PREFS, 0).edit().putString("feed_base", url.trim()).apply()

    fun unconfigured() = Snapshot(
        "Tap to open The Edition",
        "Tap to open Breakthrough Scan",
        "Tap to open Deal Hunter",
        "Feeds not configured — long-press widget → reconfigure",
    )

    fun build(context: Context, news: JSONObject?, stocks: JSONObject?, deals: JSONObject?): Snapshot {
        val newsLine = news?.optString("headline")?.takeIf { it.isNotBlank() }
            ?.let { "📰 $it" } ?: "📰 The Edition"
        val stocksLine = stocks?.optString("line")?.takeIf { it.isNotBlank() }
            ?.let { "🔬 $it" } ?: "🔬 Breakthrough Scan"
        val dealsLine = deals?.let {
            val n = it.optInt("new_count", -1)
            val top = it.optString("top")
            when {
                n > 0 && top.isNotBlank() -> "🛍️ $n new · $top"
                n == 0 -> "🛍️ No new finds today"
                else -> null
            }
        } ?: "🛍️ Deal Hunter"
        val stamp = SimpleDateFormat("HH:mm", Locale.US).format(Date())
        return Snapshot(newsLine, stocksLine, dealsLine, "Updated $stamp")
    }

    fun save(context: Context, s: Snapshot) {
        context.getSharedPreferences(PREFS, 0).edit()
            .putString("c_news", s.newsLine)
            .putString("c_stocks", s.stocksLine)
            .putString("c_deals", s.dealsLine)
            .putString("c_upd", s.updated)
            .apply()
    }

    fun cached(context: Context): Snapshot {
        val p = context.getSharedPreferences(PREFS, 0)
        if (baseUrl(context) == null) return unconfigured()
        return Snapshot(
            p.getString("c_news", "📰 The Edition")!!,
            p.getString("c_stocks", "🔬 Breakthrough Scan")!!,
            p.getString("c_deals", "🛍️ Deal Hunter")!!,
            p.getString("c_upd", "")!!,
        )
    }
}
