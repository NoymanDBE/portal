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

    /** "owner/repo" of the (private) GitHub repo holding feeds/*.json */
    fun repoSpec(context: Context): String? =
        context.getSharedPreferences(PREFS, 0).getString("feed_repo", null)
            ?.trim()?.trim('/')?.takeIf { it.matches(Regex("[\\w.-]+/[\\w.-]+")) }

    /** fine-grained GitHub token with read-only Contents access to that repo */
    fun token(context: Context): String? =
        context.getSharedPreferences(PREFS, 0).getString("feed_token", null)
            ?.trim()?.takeIf { it.isNotEmpty() }

    fun setConfig(context: Context, repo: String, token: String) =
        context.getSharedPreferences(PREFS, 0).edit()
            .putString("feed_repo", repo.trim())
            .putString("feed_token", token.trim())
            .apply()

    fun unconfigured() = Snapshot(
        "Tap to open The Edition",
        "Tap to open Breakthrough Scan",
        "Tap to open Deal Hunter",
        "Feeds not configured — re-add the widget to set them up",
    )

    fun build(news: JSONObject?, stocks: JSONObject?, deals: JSONObject?): Snapshot {
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
        if (repoSpec(context) == null) return unconfigured()
        return Snapshot(
            p.getString("c_news", "📰 The Edition")!!,
            p.getString("c_stocks", "🔬 Breakthrough Scan")!!,
            p.getString("c_deals", "🛍️ Deal Hunter")!!,
            p.getString("c_upd", "")!!,
        )
    }
}
