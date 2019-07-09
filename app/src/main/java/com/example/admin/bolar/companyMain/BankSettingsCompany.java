package com.example.admin.bolar.companyMain;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

import com.example.admin.bolar.R;

public class BankSettingsCompany extends AppCompatActivity {

    public Button connectStripe;
    public Context context;


    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_bank_settings_company);

        connectStripe = findViewById(R.id.connectStripeComp);
        context = this.getBaseContext();

        connectStripe.setOnClickListener(new View.OnClickListener() {

            @Override
            public void onClick(View v) {
                Intent intent = new Intent(BankSettingsCompany.this , WebviewStripeCompany.class);
                BankSettingsCompany.this.startActivity(intent);
                AlertDialog.Builder alert = new AlertDialog.Builder(context);
                alert.setTitle("Title here");

                WebView wv = new WebView(context);
                wv.loadUrl("https://connect.stripe.com/express/oauth/authorize?" +
                        "redirect_uri=https://us-central1-the-drone-trade.cloudfunctions.net/redirect" +
                        "&client_id=ca_B5KuW42Ir093YqD49Z5d8SAE048ZgvZF&state=thetalambda&stripe_user[business_type]=company&suggested_capabilities[]=platform_payments");
                wv.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView view, String url) {
                        view.loadUrl(url);

                        return true;
                    }
                });
            }
        });
    }

}
