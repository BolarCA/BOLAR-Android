package com.example.admin.bolar.companyMain;

import androidx.appcompat.app.AppCompatActivity;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.example.admin.bolar.R;

import java.net.MalformedURLException;
import java.net.URL;

public class WebviewStripeCompany extends AppCompatActivity {

    public WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_webview_stripe_company);

        webView = (WebView) findViewById(R.id.stripeWebCompany);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.setWebViewClient(new WebViewClient() {
            public boolean shouldOverrideUrlLoading(WebView view, String url){
                // do your handling codes here, which url is the requested url
                // probably you need to open that url rather than redirect:
                //view.loadUrl(url);

                Uri redirectUrl= Uri.parse(url);
                String authCode = redirectUrl.getQueryParameter("code");

                finish();
                return false; // then it is not handled by default action
            }
        });
        //prefill more attributes with &stripe_user[email]=user.email
        webView.loadUrl("https://connect.stripe.com/express/oauth/authorize?" +
                        "redirect_uri=https://us-central1-the-drone-trade.cloudfunctions.net/redirect" +
                        "&client_id=ca_B5KuW42Ir093YqD49Z5d8SAE048ZgvZF&state=thetalambda&stripe_user[business_type]=company&suggested_capabilities[]=platform_payments");
    }
}
