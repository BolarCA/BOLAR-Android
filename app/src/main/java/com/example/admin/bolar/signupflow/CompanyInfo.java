package com.example.admin.bolar.signupflow;

import com.example.admin.bolar.R;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.SetOptions;

import android.content.Intent;
import androidx.appcompat.app.AppCompatActivity;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.TextView;

import java.util.HashMap;
import java.util.Map;

public class CompanyInfo extends AppCompatActivity {

    private FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
    private FirebaseFirestore db = FirebaseFirestore.getInstance();

    private String personalEmail;
    private String companyEmail;
    private String position;
    private String companyName;

    private EditText compName;
    private EditText pos;
    private EditText persEmail;
    private EditText compEmail;

    private String first;
    private String last;
    private String type;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_company_info);

        Intent intent = getIntent();
        first = intent.getStringExtra("firstName");
        last = intent.getStringExtra("lastName");
        type = intent.getStringExtra("type");

        compName = findViewById(R.id.companyEdit);
        pos = findViewById(R.id.positionEdit);
        persEmail = findViewById(R.id.personalEmailEdit);
        compEmail = findViewById(R.id.companyEmailEdit);

        compName.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                boolean handled = false;
                if (actionId == EditorInfo.IME_ACTION_DONE) {
                    handled = true;
                    companyName = compName.getText().toString();
                    //storeInfo();
                }
                return handled;
            }
        });
        pos.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                boolean handled = false;
                if (actionId == EditorInfo.IME_ACTION_DONE) {
                    handled = true;
                    position = pos.getText().toString();
                    //storeInfo();
                }
                return handled;
            }
        });
        persEmail.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                boolean handled = false;
                if (actionId == EditorInfo.IME_ACTION_DONE) {
                    handled = true;
                    personalEmail = persEmail.getText().toString();
                    //storeInfo();
                }
                return handled;
            }
        });
        compEmail.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                boolean handled = false;
                if (actionId == EditorInfo.IME_ACTION_DONE) {
                    handled = true;
                    companyName = compName.getText().toString();
                    position = pos.getText().toString();
                    personalEmail = persEmail.getText().toString();
                    companyEmail = compEmail.getText().toString();
                    storeInfo();
                }
                return handled;
            }
        });
    }

    public void storeInfo(){
        if((personalEmail!=null)&&(companyEmail!=null)&&(position!=null)&&(companyName!=null)){
            Map<String, Object> accountManager = new HashMap<>();
            Map<String, Object> companyInfo = new HashMap<>();
            Map<String, Object> overallManager = new HashMap<>();
            Map<String, Object> overallCompInfo = new HashMap<>();
            Map<String, Object> verified = new HashMap<>();

            Boolean verif = false;
            accountManager.put("Position Title", position);
            accountManager.put("Email", personalEmail);
            accountManager.put("Phone Number",user.getPhoneNumber());
            overallManager.put("Account Manager", accountManager);

            companyInfo.put("Company Name", companyName);
            companyInfo.put("Company Email", companyEmail);
            overallCompInfo.put("Company Info", companyInfo);

            verified.put("verified", verif);

            db.collection(type).document(user.getUid()).set(overallManager, SetOptions.merge());
            db.collection(type).document(user.getUid()).set(overallCompInfo, SetOptions.merge());
            db.collection(type).document(user.getUid()).set(verified, SetOptions.merge());

            Intent intent = new Intent(CompanyInfo.this , ConfirmationDetails.class);
            intent.putExtra("type", type);
            intent.putExtra("firstName", first);
            intent.putExtra("lastName", last);
            CompanyInfo.this.startActivity(intent);
        }
    }
}
