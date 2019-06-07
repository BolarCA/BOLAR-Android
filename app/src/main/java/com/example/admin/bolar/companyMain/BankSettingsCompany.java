package com.example.admin.bolar.companyMain;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.net.Uri;
import android.os.AsyncTask;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;

import com.example.admin.bolar.R;

import java.net.HttpURLConnection;
import java.net.URL;

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
//                AlertDialog.Builder alert = new AlertDialog.Builder(context);
//                alert.setTitle("Title here");
//
//                WebView wv = new WebView(context);
//                wv.loadUrl("https://connect.stripe.com/express/oauth/authorize?" +
//                        "redirect_uri=https://us-central1-the-drone-trade.cloudfunctions.net/redirect" +
//                        "&client_id=ca_B5KuW42Ir093YqD49Z5d8SAE048ZgvZF&state={STATE_VALUE}");
//                wv.setWebViewClient(new WebViewClient() {
//                    @Override
//                    public boolean shouldOverrideUrlLoading(WebView view, String url) {
//                        view.loadUrl(url);
//
//                        return true;
//                    }
//                });
//
//                alert.setView(wv);
//                alert.setNegativeButton("Close", new DialogInterface.OnClickListener() {
//                    @Override
//                    public void onClick(DialogInterface dialog, int id) {
//                        dialog.dismiss();
//                    }
//                });
//                alert.show();

                //launchStripe();

                //@SuppressLint("StaticFieldLeak")
                //&stripe_user[business_type]=company add to specify
//                new AsyncTask<Void,Void,Void>(){
//                    private Exception exception;
//                    @Override
//                    protected Void doInBackground(Void... voids) {
//                        try{
//                            URL url= new URL("https://connect.stripe.com/express/oauth/authorize?redirect_uri=https://us-central1-the-drone-trade.cloudfunctions.net/redirect&client_id=ca_B5KuW42Ir093YqD49Z5d8SAE048ZgvZF&state={STATE_VALUE}");
//                            HttpURLConnection con= (HttpURLConnection) url.openConnection();
//                            //write additional POST data to url.getOutputStream() if you wanna use POST method
//                        }catch (Exception ex){
//                            this.exception=ex;
//                        }
//                        return null;
//                    }
//
//                    @Override
//                    protected void onPostExecute(Void aVoid) {
//                        super.onPostExecute(aVoid);
//                    }
//                }.execute();
            }
        });
    }

//    public void launchStripe(){
//        context.startActivity(new Intent(Intent.ACTION_QUICK_VIEW,
//                Uri.parse("https://connect.stripe.com/express/oauth/authorize?" +
//                        "redirect_uri=https://us-central1-bolar-ea96c.cloudfunctions.net/StripeCreateConnectRedirect" +
//                        "&client_id=ca_B5KuW42Ir093YqD49Z5d8SAE048ZgvZF&state={STATE_VALUE}")));
//    }
}
